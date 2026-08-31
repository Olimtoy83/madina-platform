import { equal } from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'
import { LoginRateLimiter } from './LoginRateLimiter.js'
import { firstPilotTrustedProxyAddresses } from './trustedProxy.js'

test('login limiter uses the forwarded client IP only through the loopback proxy', async () => {
  const limiter = new LoginRateLimiter()
  const app = Fastify({ trustProxy: [...firstPilotTrustedProxyAddresses] })
  app.post('/login', async (request, reply) => {
    const result = limiter.check(request.ip, 1_000)
    if (!result.allowed) return reply.code(429).send({ status: 'blocked' })
    limiter.recordFailure(request.ip, 1_000)
    return reply.code(401).send({ status: 'rejected' })
  })

  try {
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST', url: '/login', remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.10' },
      })
      equal(response.statusCode, 401)
    }

    const blocked = await app.inject({
      method: 'POST', url: '/login', remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })
    equal(blocked.statusCode, 429)

    const otherClient = await app.inject({
      method: 'POST', url: '/login', remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.11' },
    })
    equal(otherClient.statusCode, 401)
  } finally {
    await app.close()
  }
})
