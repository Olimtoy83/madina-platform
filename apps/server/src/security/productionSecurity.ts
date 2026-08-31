import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'

export const logRedactionPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  'req.body.password',
  'req.body.initialPassword',
  'req.body.passwordConfirmation',
  'req.body.confirmPassword',
] as const

export const productionSecurityHeaders = {
  'content-security-policy': "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const

function safeClientErrorMessage(statusCode: number): string {
  if (statusCode === 400) return 'Bad request.'
  if (statusCode === 401) return 'Authentication required.'
  if (statusCode === 403) return 'Permission denied.'
  if (statusCode === 404) return 'Not found.'
  if (statusCode === 413) return 'Request payload is too large.'
  if (statusCode === 415) return 'Unsupported media type.'
  if (statusCode === 429) return 'Too many requests. Try again later.'
  return 'Request could not be processed.'
}

export function installProductionSecurity(
  app: FastifyInstance,
  isProduction: boolean,
): void {
  app.addHook('onSend', async (_, reply, payload) => {
    for (const [header, value] of Object.entries(productionSecurityHeaders)) {
      reply.header(header, value)
    }

    if (isProduction) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
    }

    return payload
  })

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error({ err: error }, 'Unhandled request error')
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500
    const message = isProduction
      ? (statusCode >= 500 ? 'Internal server error.' : safeClientErrorMessage(statusCode))
      : error.message

    reply.code(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? 'Internal Server Error' : error.name,
      message,
    })
  })
}
