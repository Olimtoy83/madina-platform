import type {
  ApiErrorResponse,
  CreateVehicleRequest,
  UpdateVehicleRequest,
  VehicleResponse,
  VehiclesListQuery,
  VehiclesListResponse,
} from '@madina/api'
import type {
  Vehicle,
  VehicleRepository,
  VehicleService,
} from '@madina/core'
import {
  VehicleNotFoundError,
  VehicleValidationError,
} from '@madina/core'
import type { FastifyInstance } from 'fastify'
import {
  getAuthenticatedCommandContext,
  requirePermission,
  requireTrustedOrigin,
} from '../../../../plugins/authentication.js'

interface KoreaAutoRoutesOptions {
  vehicleRepository: VehicleRepository
  vehicleService: VehicleService
}

interface VehicleParams {
  vehicleId: string
}

interface VehicleCursor {
  version: 1
  createdAt: string
  id: string
  throughCreatedAt: string
}

interface NormalizedVehiclesListQuery {
  limit: number
  throughCreatedAt: Date
  cursor?: { createdAt: Date; id: string }
}

const DEFAULT_VEHICLES_LIMIT = 50
const MAX_VEHICLES_LIMIT = 100

class VehiclesListValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VehiclesListValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInstant(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new VehiclesListValidationError('Vehicles cursor is invalid.')
  }
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new VehiclesListValidationError('Vehicles cursor is invalid.')
  }
  return instant
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_VEHICLES_LIMIT
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new VehiclesListValidationError('Vehicles limit is invalid.')
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_VEHICLES_LIMIT) {
    throw new VehiclesListValidationError(
      `Vehicles limit must be between 1 and ${MAX_VEHICLES_LIMIT}.`,
    )
  }
  return limit
}

function decodeCursor(value: unknown): VehicleCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new VehiclesListValidationError('Vehicles cursor is invalid.')
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const allowedKeys = ['version', 'createdAt', 'id', 'throughCreatedAt']
    if (!isRecord(decoded) || Object.keys(decoded).some((key) => !allowedKeys.includes(key)) ||
      decoded.version !== 1 || typeof decoded.id !== 'string' || !decoded.id.trim()) {
      throw new Error()
    }
    return {
      version: 1,
      createdAt: parseInstant(decoded.createdAt).toISOString(),
      id: decoded.id,
      throughCreatedAt: parseInstant(decoded.throughCreatedAt).toISOString(),
    }
  } catch (error) {
    if (error instanceof VehiclesListValidationError) throw error
    throw new VehiclesListValidationError('Vehicles cursor is invalid.')
  }
}

function normalizeListQuery(
  input: VehiclesListQuery | unknown,
  now: Date,
): NormalizedVehiclesListQuery {
  if (!isRecord(input) || Object.keys(input).some((key) => !['limit', 'cursor'].includes(key))) {
    throw new VehiclesListValidationError('Vehicles query is invalid.')
  }
  const cursor = decodeCursor(input.cursor)
  return {
    limit: parseLimit(input.limit),
    throughCreatedAt: cursor ? new Date(cursor.throughCreatedAt) : now,
    cursor: cursor ? { createdAt: new Date(cursor.createdAt), id: cursor.id } : undefined,
  }
}

function encodeCursor(
  vehicle: VehicleResponse,
  query: NormalizedVehiclesListQuery,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    createdAt: vehicle.createdAt,
    id: vehicle.id,
    throughCreatedAt: query.throughCreatedAt.toISOString(),
  } satisfies VehicleCursor)).toString('base64url')
}

function toVehicleResponse(vehicle: Vehicle): VehicleResponse {
  return {
    id: vehicle.id,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    status: vehicle.status,
  }
}

function badRequestResponse(message: string): ApiErrorResponse {
  return { statusCode: 400, error: 'Bad Request', message }
}

export async function koreaAutoRoutes(
  app: FastifyInstance,
  options: KoreaAutoRoutesOptions,
) {
  app.get<{
    Querystring: VehiclesListQuery
  }>(
    '/vehicles',
    { preHandler: requirePermission(app, 'korea-auto:read') },
    async (request, reply): Promise<VehiclesListResponse | ApiErrorResponse> => {
      try {
        const query = normalizeListQuery(request.query, new Date())
        const vehicles = await options.vehicleRepository.list({
          ...query,
          limit: query.limit + 1,
        })
        const items = vehicles.slice(0, query.limit).map(toVehicleResponse)
        const last = items.at(-1)
        return {
          vehicles: {
            items,
            nextCursor: vehicles.length > query.limit && last
              ? encodeCursor(last, query)
              : undefined,
          },
        }
      } catch (error) {
        if (error instanceof VehiclesListValidationError) {
          reply.code(400)
          return badRequestResponse(error.message)
        }
        throw error
      }
    },
  )

  app.get<{
    Params: VehicleParams
  }>(
    '/vehicles/:vehicleId',
    { preHandler: requirePermission(app, 'korea-auto:read') },
    async (request, reply): Promise<VehicleResponse | ApiErrorResponse> => {
      const vehicle = await options.vehicleRepository.findById(request.params.vehicleId)
      if (!vehicle) {
        reply.code(404)
        return { statusCode: 404, error: 'Not Found', message: 'Vehicle not found.' }
      }
      return toVehicleResponse(vehicle)
    },
  )

  app.post<{
    Body: CreateVehicleRequest
  }>(
    '/vehicles',
    {
      preHandler: [
        requirePermission(app, 'korea-auto:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<VehicleResponse | ApiErrorResponse> => {
      try {
        const vehicle = await options.vehicleService.create(
          request.body,
          getAuthenticatedCommandContext(request),
        )
        reply.code(201)
        return toVehicleResponse(vehicle)
      } catch (error) {
        if (error instanceof VehicleValidationError) {
          reply.code(400)
          return badRequestResponse(error.message)
        }
        throw error
      }
    },
  )

  app.patch<{
    Params: VehicleParams
    Body: UpdateVehicleRequest
  }>(
    '/vehicles/:vehicleId',
    {
      preHandler: [
        requirePermission(app, 'korea-auto:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<VehicleResponse | ApiErrorResponse> => {
      try {
        const vehicle = await options.vehicleService.update(
          request.params.vehicleId,
          request.body,
          getAuthenticatedCommandContext(request),
        )
        return toVehicleResponse(vehicle)
      } catch (error) {
        if (error instanceof VehicleNotFoundError) {
          reply.code(404)
          return { statusCode: 404, error: 'Not Found', message: error.message }
        }
        if (error instanceof VehicleValidationError) {
          reply.code(400)
          return badRequestResponse(error.message)
        }
        throw error
      }
    },
  )
}
