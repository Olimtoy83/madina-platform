import type {
  ApiErrorResponse,
  AuthUserResponse,
  CreateUserRequest,
  LoginRequest,
  LoginResponse,
  ManagedUserResponse,
  LogoutResponse,
  MeResponse,
  ResetUserPasswordRequest,
  RevokeUserSessionsResponse,
  UpdateUserRequest,
  UsersListResponse,
} from '@madina/api'
import {
  AuthService,
  DuplicateUserError,
  InvalidCredentialsError,
  LastActiveAdminError,
  PasswordValidationError,
  UserManagementService,
  UserManagementValidationError,
  UserNotFoundError,
  UsernameValidationError,
  type AuthPrincipal,
  type User,
} from '@madina/auth'
import type {
  FastifyInstance,
  FastifyRequest,
} from 'fastify'
import {
  getSessionCookieName,
  getSessionSecret,
  getAuthenticatedCommandContext,
  requireAuthentication,
  requirePermission,
  requireTrustedOrigin,
  sessionCookieOptions,
} from '../../../../plugins/authentication.js'
import type { LoginRateLimiter } from '../../../../security/LoginRateLimiter.js'

interface AuthRoutesOptions {
  authService: AuthService
  loginRateLimiter: LoginRateLimiter
  userManagementService: UserManagementService
}

interface UserParams {
  userId: string
}

function toUserResponse(principal: AuthPrincipal): AuthUserResponse {
  return {
    id: principal.id,
    username: principal.username,
    role: principal.role,
  }
}

function unauthorizedResponse(): ApiErrorResponse {
  return {
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Authentication required.',
  }
}

function invalidCredentialsResponse(): ApiErrorResponse {
  return {
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid username or password.',
  }
}

function rateLimitResponse(): ApiErrorResponse {
  return {
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Too many login attempts. Try again later.',
  }
}

function toManagedUserResponse(user: User): ManagedUserResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

function badRequestResponse(message: string): ApiErrorResponse {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message,
  }
}

function userManagementErrorResponse(
  error: unknown,
): ApiErrorResponse | undefined {
  if (error instanceof UserNotFoundError) {
    return {
      statusCode: 404,
      error: 'Not Found',
      message: 'User not found.',
    }
  }

  if (
    error instanceof DuplicateUserError ||
    error instanceof LastActiveAdminError
  ) {
    return {
      statusCode: 409,
      error: 'Conflict',
      message: error.message,
    }
  }

  if (
    error instanceof UserManagementValidationError ||
    error instanceof UsernameValidationError ||
    error instanceof PasswordValidationError
  ) {
    return badRequestResponse(error.message)
  }

  return undefined
}

function isLoginRequest(value: unknown): value is LoginRequest {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as LoginRequest).username === 'string' &&
    typeof (value as LoginRequest).password === 'string'
}

function isCreateUserRequest(value: unknown): value is CreateUserRequest {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as CreateUserRequest).username === 'string' &&
    typeof (value as CreateUserRequest).initialPassword === 'string' &&
    typeof (value as CreateUserRequest).role === 'string' &&
    (
      (value as CreateUserRequest).email === undefined ||
      typeof (value as CreateUserRequest).email === 'string'
    )
}

function isUpdateUserRequest(value: unknown): value is UpdateUserRequest {
  if (typeof value !== 'object' || value === null) return false

  const input = value as UpdateUserRequest

  return (input.role !== undefined || input.status !== undefined) &&
    (input.role === undefined || typeof input.role === 'string') &&
    (input.status === undefined || typeof input.status === 'string')
}

function isResetUserPasswordRequest(
  value: unknown,
): value is ResetUserPasswordRequest {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as ResetUserPasswordRequest).password === 'string'
}

async function getAuthenticatedPrincipal(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthPrincipal | null> {
  return app.authenticateRequest(request)
}

export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
) {
  app.post<{
    Body: LoginRequest
  }>(
    '/login',
    async (request, reply): Promise<LoginResponse | ApiErrorResponse> => {
      const rateLimit = options.loginRateLimiter.check(request.ip)

      if (!rateLimit.allowed) {
        reply.header('Retry-After', String(rateLimit.retryAfterSeconds))
        reply.code(429)
        return rateLimitResponse()
      }

      if (!isLoginRequest(request.body)) {
        options.loginRateLimiter.recordFailure(request.ip)
        reply.code(401)
        return invalidCredentialsResponse()
      }

      try {
        const session = await options.authService.login(
          request.body.username,
          request.body.password,
        )
        reply.setCookie(
          getSessionCookieName(),
          session.sessionSecret,
          sessionCookieOptions(),
        )

        return {
          user: toUserResponse(session.principal),
        }
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          options.loginRateLimiter.recordFailure(request.ip)
          reply.code(401)
          return invalidCredentialsResponse()
        }

        throw error
      }
    },
  )

  app.get(
    '/me',
    {
      preHandler: requireAuthentication(app),
    },
    async (request, reply): Promise<MeResponse | ApiErrorResponse> => {
      const principal = await getAuthenticatedPrincipal(app, request)

      if (!principal) {
        reply.code(401)
        return unauthorizedResponse()
      }

      return {
        user: toUserResponse(principal),
      }
    },
  )

  app.get(
    '/users',
    {
      preHandler: requirePermission(app, 'users:manage'),
    },
    async (): Promise<UsersListResponse> => ({
      users: (await options.userManagementService.listUsers()).map(
        toManagedUserResponse,
      ),
    }),
  )

  app.post<{
    Body: CreateUserRequest
  }>(
    '/users',
    {
      preHandler: [
        requirePermission(app, 'users:manage'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<ManagedUserResponse | ApiErrorResponse> => {
      if (!isCreateUserRequest(request.body)) {
        reply.code(400)
        return badRequestResponse('User input is invalid.')
      }

      try {
        const user = await options.userManagementService.createUser(
          request.body,
          getAuthenticatedCommandContext(request),
        )
        reply.code(201)
        return toManagedUserResponse(user)
      } catch (error) {
        const response = userManagementErrorResponse(error)

        if (response) {
          reply.code(response.statusCode)
          return response
        }

        throw error
      }
    },
  )

  app.patch<{
    Params: UserParams
    Body: UpdateUserRequest
  }>(
    '/users/:userId',
    {
      preHandler: [
        requirePermission(app, 'users:manage'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<ManagedUserResponse | ApiErrorResponse> => {
      if (!isUpdateUserRequest(request.body)) {
        reply.code(400)
        return badRequestResponse('User input is invalid.')
      }

      try {
        const user = await options.userManagementService.updateUser(
          request.params.userId,
          request.body,
          getAuthenticatedCommandContext(request),
        )
        return toManagedUserResponse(user)
      } catch (error) {
        const response = userManagementErrorResponse(error)

        if (response) {
          reply.code(response.statusCode)
          return response
        }

        throw error
      }
    },
  )

  app.post<{
    Params: UserParams
    Body: ResetUserPasswordRequest
  }>(
    '/users/:userId/password',
    {
      preHandler: [
        requirePermission(app, 'users:manage'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<RevokeUserSessionsResponse | ApiErrorResponse> => {
      if (!isResetUserPasswordRequest(request.body)) {
        reply.code(400)
        return badRequestResponse('User password input is invalid.')
      }

      try {
        await options.userManagementService.resetPassword(
          request.params.userId,
          request.body.password,
          getAuthenticatedCommandContext(request),
        )
        return { success: true }
      } catch (error) {
        const response = userManagementErrorResponse(error)

        if (response) {
          reply.code(response.statusCode)
          return response
        }

        throw error
      }
    },
  )

  app.post<{
    Params: UserParams
  }>(
    '/users/:userId/revoke-sessions',
    {
      preHandler: [
        requirePermission(app, 'users:manage'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<RevokeUserSessionsResponse | ApiErrorResponse> => {
      try {
        await options.userManagementService.revokeSessions(
          request.params.userId,
          getAuthenticatedCommandContext(request),
        )
        return { success: true }
      } catch (error) {
        const response = userManagementErrorResponse(error)

        if (response) {
          reply.code(response.statusCode)
          return response
        }

        throw error
      }
    },
  )

  app.post(
    '/logout',
    {
      preHandler: requireTrustedOrigin(),
    },
    async (request, reply): Promise<LogoutResponse> => {
      await getAuthenticatedPrincipal(app, request)
      const sessionSecret = getSessionSecret(request)

      if (sessionSecret) {
        await options.authService.logout(sessionSecret)
      }

      reply.clearCookie(
        getSessionCookieName(),
        sessionCookieOptions(),
      )

      return { success: true }
    },
  )
}
