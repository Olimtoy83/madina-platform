import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import { retailRoutes } from './index.js'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

test('retail boundary composes without routes or CRM dependencies', async () => {
  const repositoryRoot = resolve(process.cwd(), '..', '..')
  const retail = readManifest(resolve(repositoryRoot, 'packages/retail/package.json'))
  const crm = readManifest(resolve(repositoryRoot, 'apps/crm/package.json'))

  deepEqual(retail.dependencies ?? {}, {})
  equal(retail.devDependencies?.['@madina/core'], undefined)
  equal(crm.dependencies?.['@madina/retail'], undefined)

  const app = Fastify()
  app.register(retailRoutes, { prefix: '/retail' })
  try {
    await app.ready()
    equal((await app.inject({ method: 'GET', url: '/retail' })).statusCode, 404)
  } finally {
    await app.close()
  }
})
