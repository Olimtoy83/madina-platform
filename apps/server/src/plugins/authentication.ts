import type { AuthPrincipal, AuthService } from '@madina/auth'
import type {
  FastifyPluginAsync,
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
