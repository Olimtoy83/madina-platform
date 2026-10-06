import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  assertSabonoUatDatabaseFile,
  assertSabonoUatProvisioning,
  defaultSabonoUatDatabaseFile,
  provisionSabonoUat,
} from './provisionSabonoUat.js'

export async function runProvisionSabonoUatCommand(
  arguments_ = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (arguments_.some((argument) => argument !== '--reset')) {
    throw new Error('Usage: pnpm uat:provision -- [--reset]')
  }
  const databaseFile = assertSabonoUatDatabaseFile(
    environment.SABONO_UAT_DATABASE_FILE ?? defaultSabonoUatDatabaseFile,
  )
  const password = environment.UAT_MANAGER_PASSWORD
  if (!password) throw new Error('UAT_MANAGER_PASSWORD must be set.')

  process.stdout.write(`SABONO UAT database: ${databaseFile}\n`)
  const summary = await provisionSabonoUat({
    databaseFile,
    password,
    reset: arguments_.includes('--reset'),
  })
  await assertSabonoUatProvisioning(databaseFile, summary)
  verifyDatabase(databaseFile, summary)
  process.stdout.write(`Provisioned UAT user: uat_manager (${summary.userId})\n`)
}

function verifyDatabase(
  databaseFile: string,
  summary: Awaited<ReturnType<typeof provisionSabonoUat>>,
): void {
  if (!existsSync(databaseFile)) throw new Error('UAT database was not created.')
  const database = new DatabaseSync(databaseFile)
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (integrity.integrity_check !== 'ok') throw new Error('UAT database integrity check failed.')
    if ((database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length) throw new Error('UAT database foreign key check failed.')
    const sales = database.prepare('SELECT COUNT(*) AS count FROM retail_sales').get() as { count: number }
    const returns = database.prepare('SELECT COUNT(*) AS count FROM retail_sale_returns').get() as { count: number }
    if (sales.count !== 0 || returns.count !== 0) throw new Error('UAT database unexpectedly contains sales or returns.')
    if (summary.products.length !== 3) throw new Error('UAT dataset summary is incomplete.')
  } finally {
    database.close()
  }
}
