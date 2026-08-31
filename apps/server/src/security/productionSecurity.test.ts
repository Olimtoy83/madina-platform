import { equal } from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'
import {
  installProductionSecurity,
  logRedactionPaths,
} from './productionSecurity.js'

test('production security headers include HSTS and safe baseline headers', async () => {
  const app = Fastify()
  installProductionSecurity(app, true)
  app.get('/ok', async () => ({ ok: true }))

  try {
    const response = await app.inject('/ok')
    equal(response.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains')
    equal(response.headers['x-content-type-options'], 'nosniff')
    equal(response.headers['x-frame-options'], 'DENY')
    equal(response.headers['content-security-policy'], "base-uri 'self'; frame-ancestors 'none'; object-src 'none'")
  } finally {
    await app.close()
  }
})

test('development omits HSTS while retaining baseline headers', async () => {
  const app = Fastify()
  installProductionSecurity(app, false)
  app.get('/ok', async () => ({ ok: true }))

  try {
    const response = await app.inject('/ok')
    equal(response.headers['strict-transport-security'], undefined)
    equal(response.headers['x-content-type-options'], 'nosniff')
  } finally {
    await app.close()
  }
})

test('production errors do not expose internals', async () => {
  const app = Fastify()
  installProductionSecurity(app, true)
  app.get('/failure', async () => {
    throw new Error('SQLite failed at C:\\private\\madina.sqlite')
  })

  try {
    const response = await app.inject('/failure')
    equal(response.statusCode, 500)
    equal(response.json().message, 'Internal server error.')
    equal(response.body.includes('private'), false)
  } finally {
    await app.close()
  }
})

test('redaction configuration protects credential headers and password fields', () => {
  equal(logRedactionPaths.includes('req.headers.cookie'), true)
  equal(logRedactionPaths.includes('req.headers.authorization'), true)
  equal(logRedactionPaths.includes('res.headers.set-cookie'), true)
  equal(logRedactionPaths.includes('req.body.password'), true)
  equal(logRedactionPaths.includes('req.body.initialPassword'), true)
})
