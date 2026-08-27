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
import type {
  Client,
  Product,
  Task,
} from '@madina/core'
import { SqliteClientRepository } from '../clients/SqliteClientRepository.js'
import { SqliteCommerceRepository } from '../commerce/SqliteCommerceRepository.js'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteTaskRepository } from '../tasks/SqliteTaskRepository.js'

const now = new Date('2026-08-28T00:00:00.000Z')

function withDatabaseFile(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-domain-repositories-'))
  const filename = join(directory, 'madina.sqlite')

  return run(filename).finally(() => {
    rmSync(directory, { recursive: true, force: true })
  })
}

test('domain repositories work after initializeDatabase', async () => {
  await withDatabaseFile(async (filename) => {
    initializeDatabase(filename)
    const clients = new SqliteClientRepository(filename)
    const tasks = new SqliteTaskRepository(filename)
    const commerce = new SqliteCommerceRepository(filename)

    const client: Client = {
      id: 'client-1', createdAt: now, updatedAt: now,
      name: 'Мадина', status: 'active',
    }
    const task: Task = {
      id: 'task-1', createdAt: now, updatedAt: now,
      title: 'Проверить склад', status: 'todo', priority: 'medium',
    }
    const product: Product = {
      id: 'product-1', createdAt: now, updatedAt: now,
      name: 'Финики', category: 'dates', quantity: 5, unit: 'kg',
      costPrice: 100, salePrice: 150, status: 'active',
    }

    try {
      await clients.save(client)
      await tasks.save(task)
      await commerce.saveProduct(product)

      equal((await clients.findById(client.id))?.name, 'Мадина')
      equal((await tasks.findById(task.id))?.title, 'Проверить склад')
      equal((await commerce.findAllProducts())[0]?.name, 'Финики')
    } finally {
      clients.close()
      tasks.close()
      commerce.close()
    }
  })
})

test('domain repositories do not create tables on an unprepared database', async () => {
  await withDatabaseFile(async (filename) => {
    const clients = new SqliteClientRepository(filename)
    const tasks = new SqliteTaskRepository(filename)
    const commerce = new SqliteCommerceRepository(filename)

    try {
      await rejects(clients.findAll(), /no such table: clients/)
      await rejects(tasks.findAll(), /no such table: tasks/)
      await rejects(commerce.findAllProducts(), /no such table: products/)
    } finally {
      clients.close()
      tasks.close()
      commerce.close()
    }

    const database = new DatabaseSync(filename)
    try {
      const tables = database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'clients', 'tasks', 'products', 'purchases', 'purchase_items',
          'sales', 'sale_items', 'stock_movements', 'transactions'
        )
      `).all()
      equal(tables.length, 0)
    } finally {
      database.close()
    }
  })
})
