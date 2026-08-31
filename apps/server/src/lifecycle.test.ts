import { equal } from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'
import { createGracefulShutdown } from './lifecycle.js'

test('graceful shutdown closes Fastify once and exits successfully', async () => {
  const app = Fastify()
  let closeCount = 0
  let exitCode: number | undefined
  app.addHook('onClose', async () => { closeCount += 1 })

  const shutdown = createGracefulShutdown(app, (code) => {
    exitCode = code
  })

  await Promise.all([shutdown(), shutdown()])

  equal(closeCount, 1)
  equal(exitCode, 0)
})
