import {
  equal,
  rejects,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  clientsSchemaSql,
  commerceLegacySchemaSql,
  DomainSchemaVerificationError,
  tasksSchemaSql,
} from '@madina/database'
import { buildApp } from '../../../app.js'

async function withAppDatabase(
  prepare: (databaseFile: string) => void,
  run: (app: ReturnType<typeof buildApp>, databaseFile: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-server-initialization-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  prepare(databaseFile)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()

  try {
    await run(app, databaseFile)
  } finally {
    await app.close()
    if (previousDatabaseFile === undefined) {
      delete process.env.DATABASE_FILE
    } else {
      process.env.DATABASE_FILE = previousDatabaseFile
    }
    rmSync(directory, { recursive: true, force: true })
  }
}

test('server starts on a fresh unified-initialized database', async () => {
  await withAppDatabase(
    () => {},
    async (app, databaseFile) => {
      await app.ready()

      const database = new DatabaseSync(databaseFile)
      try {
        const migrations = database.prepare(`
          SELECT COUNT(*) AS count FROM schema_migrations
        `).get() as { count: number }
        equal(migrations.count, 9)
      } finally {
        database.close()
      }
    },
  )
})

test('server starts on an adopted legacy database', async () => {
  await withAppDatabase(
    (databaseFile) => {
      const database = new DatabaseSync(databaseFile)
      try {
        database.exec(`
          ${clientsSchemaSql}
          ${tasksSchemaSql}
          ${commerceLegacySchemaSql}
        `)
        database.prepare(`
          INSERT INTO clients (
            id, created_at, updated_at, name, phone, email, company, note, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'client-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
          'Мадина', null, null, null, 'Legacy', 'active',
        )
      } finally {
        database.close()
      }
    },
    async (app) => {
      await app.ready()
      equal((await app.inject({
        method: 'GET',
        url: '/api/v1/clients',
      })).statusCode, 401)
    },
  )
})

test('server fails before repository setup on a mismatched database', async () => {
  await withAppDatabase(
    (databaseFile) => {
      const database = new DatabaseSync(databaseFile)
      try {
        database.exec('CREATE TABLE clients (id TEXT PRIMARY KEY)')
      } finally {
        database.close()
      }
    },
    async (app) => {
      await rejects(
        async () => { await app.ready() },
        DomainSchemaVerificationError,
      )
    },
  )
})
