import { equal } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import test from 'node:test'
import { healthRoutes } from './health.js'

test('health stays live and readiness checks a usable database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-ready-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const database = new DatabaseSync(databaseFile)
  database.close()
  const app = Fastify()
  await app.register(healthRoutes, { getDatabaseFile: () => databaseFile })

  try {
    equal((await app.inject('/health')).statusCode, 200)
    const ready = await app.inject('/ready')
    equal(ready.statusCode, 200)
    equal(ready.json().status, 'ready')
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('readiness fails without exposing database details', async () => {
  const app = Fastify()
  await app.register(healthRoutes, {
    getDatabaseFile: () => 'invalid\0database.sqlite',
  })

  try {
    const response = await app.inject('/ready')
    equal(response.statusCode, 503)
    equal(response.json().status, 'not_ready')
  } finally {
    await app.close()
  }
})
