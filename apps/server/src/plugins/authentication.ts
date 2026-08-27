import {
  hasPermission,
  type AuthPrincipal,
  type AuthService,
  type Permission,
} from '@madina/auth'
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyInstance,
  FastifyRequest,
} from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    authPrincipal: AuthPrincipal | null
  }

  interface FastifyInstance {
    authenticateRequest(
      request: FastifyRequest,
    ): Promise<AuthPrincipal | null>
  }
}

export interface AuthenticationPluginOptions {
  authService: AuthService
}

type AuthenticationGuard = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>

const safeMethods = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
])

function sendAuthenticationError(reply: FastifyReply): void {
  reply.code(401).send({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Authentication required.',
  })
}

function sendPermissionError(reply: FastifyReply): void {
  reply.code(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Permission denied.',
  })
}

function sendOriginError(reply: FastifyReply): void {
  reply.code(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Request origin is not allowed.',
  })
}

function configuredAllowedOrigins(): readonly string[] {
  return (process.env.MADINA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function isDevelopmentLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)

    return url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function isAllowedOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin

  if (!origin) {
    return false
  }

  const host = request.headers.host
  const currentOrigin = host
    ? `${request.protocol}://${host}`
    : undefined

  if (
    origin === currentOrigin ||
    configuredAllowedOrigins().includes(origin)
  ) {
    return true
  }

  return process.env.NODE_ENV !== 'production' &&
    isDevelopmentLoopbackOrigin(origin)
}

export function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Host-madina-session'
    : 'madina-session'
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60,
  }
}

export function getSessionSecret(
  request: FastifyRequest,
): string | undefined {
  return request.cookies[getSessionCookieName()]
}

export function requireAuthentication(
  app: FastifyInstance,
): AuthenticationGuard {
  return async (request, reply) => {
    const principal = await app.authenticateRequest(request)

    if (!principal) {
      sendAuthenticationError(reply)
    }
  }
}

export function requirePermission(
  app: FastifyInstance,
  permission: Permission,
): AuthenticationGuard {
  return async (request, reply) => {
    const principal = await app.authenticateRequest(request)

    if (!principal) {
      sendAuthenticationError(reply)
      return
    }

    if (!hasPermission(principal.role, permission)) {
      sendPermissionError(reply)
    }
  }
}

export function requireTrustedOrigin(): AuthenticationGuard {
  return async (request, reply) => {
    if (!safeMethods.has(request.method) && !isAllowedOrigin(request)) {
      sendOriginError(reply)
    }
  }
}

export const authenticationPlugin: FastifyPluginAsync<
  AuthenticationPluginOptions
> = async (app, options) => {
  app.decorateRequest('authPrincipal', null)

  app.decorate(
    'authenticateRequest',
    async (request: FastifyRequest): Promise<AuthPrincipal | null> => {
      if (request.authPrincipal) {
        return request.authPrincipal
      }

      const sessionSecret = getSessionSecret(request)

      if (!sessionSecret) {
        return null
      }

      const principal = await options.authService.authenticate(sessionSecret)
      request.authPrincipal = principal ?? null
      return request.authPrincipal
    },
  )
}
