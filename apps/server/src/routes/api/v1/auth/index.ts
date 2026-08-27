import type {
  ApiErrorResponse,
  AuthUserResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
} from '@madina/api'
import {
  AuthService,
  InvalidCredentialsError,
  type AuthPrincipal,
} from '@madina/auth'
import type {
  FastifyInstance,
  FastifyRequest,
} from 'fastify'
import {
  getSessionCookieName,
  getSessionSecret,
  requireAuthentication,
  sessionCookieOptions,
} from '../../../../plugins/authentication.js'

interface AuthRoutesOptions {
  authService: AuthService
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

function isLoginRequest(value: unknown): value is LoginRequest {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as LoginRequest).username === 'string' &&
    typeof (value as LoginRequest).password === 'string'
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
      if (!isLoginRequest(request.body)) {
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

  app.post(
    '/logout',
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
