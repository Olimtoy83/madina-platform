import { equal } from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'
import { firstPilotTrustedProxyAddresses } from './trustedProxy.js'

test('a loopback proxy resolves a forwarded client IP', async () => {
  const app = Fastify({ trustProxy: [...firstPilotTrustedProxyAddresses] })
  app.get('/ip', async (request) => ({ ip: request.ip }))

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })
    equal(response.json().ip, '203.0.113.10')
  } finally {
    await app.close()
  }
})

test('an untrusted direct peer cannot spoof a forwarded client IP', async () => {
  const app = Fastify({ trustProxy: [...firstPilotTrustedProxyAddresses] })
  app.get('/ip', async (request) => ({ ip: request.ip }))

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '203.0.113.50',
      headers: { 'x-forwarded-for': '198.51.100.4' },
    })
    equal(response.json().ip, '203.0.113.50')
  } finally {
    await app.close()
  }
})
