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
import {
  ClientMutationService,
  TaskMutationService,
} from '@madina/core'
import { SqliteAuditRepository } from '../audit/SqliteAuditRepository.js'
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

test('client audit failure rolls back a status and field update atomically', async () => {
  await withDatabaseFile(async (filename) => {
    initializeDatabase(filename)
    const repository = new SqliteClientRepository(filename)
    const service = new ClientMutationService(repository)
    const client: Client = {
      id: 'client-rollback', createdAt: now, updatedAt: now,
      name: 'До обновления', status: 'active',
    }

    try {
      await repository.save(client)
      const database = new DatabaseSync(filename)
      try {
        database.exec(`
          CREATE TRIGGER reject_client_status_audit
          BEFORE INSERT ON audit_events
          WHEN NEW.action = 'client.status_changed'
          BEGIN SELECT RAISE(ABORT, 'audit rejected by test trigger'); END
        `)
      } finally {
        database.close()
      }

      await rejects(
        service.update(client.id, {
          name: 'После обновления',
          status: 'inactive',
        }, {
          actorType: 'user', actorUserId: 'admin-1', requestId: 'request-1',
        }),
        /audit rejected by test trigger/,
      )

      equal((await repository.findById(client.id))?.name, 'До обновления')
      equal((await repository.findById(client.id))?.status, 'active')
      const auditRepository = new SqliteAuditRepository(filename)
      try {
        equal((await auditRepository.findAll()).length, 0)
      } finally {
        auditRepository.close()
      }
    } finally {
      repository.close()
    }
  })
})

test('client import audit failure rolls back every imported row', async () => {
  await withDatabaseFile(async (filename) => {
    initializeDatabase(filename)
    const repository = new SqliteClientRepository(filename)
    const service = new ClientMutationService(repository)

    try {
      const database = new DatabaseSync(filename)
      try {
        database.exec(`
          CREATE TRIGGER reject_client_import_audit
          BEFORE INSERT ON audit_events
          WHEN NEW.action = 'clients.imported'
          BEGIN SELECT RAISE(ABORT, 'import audit rejected by test trigger'); END
        `)
      } finally {
        database.close()
      }

      await rejects(
        service.import([
          { id: 'import-1', createdAt: now, updatedAt: now, name: 'Первый', status: 'active' },
          { id: 'import-2', createdAt: now, updatedAt: now, name: 'Второй', status: 'active' },
        ], {
          actorType: 'user', actorUserId: 'admin-1', requestId: 'request-2',
        }),
        /import audit rejected by test trigger/,
      )

      equal(await repository.findById('import-1'), undefined)
      equal(await repository.findById('import-2'), undefined)
      const auditRepository = new SqliteAuditRepository(filename)
      try {
        equal((await auditRepository.findAll()).length, 0)
      } finally {
        auditRepository.close()
      }
    } finally {
      repository.close()
    }
  })
})

test('task audit failure rolls back a hard delete', async () => {
  await withDatabaseFile(async (filename) => {
    initializeDatabase(filename)
    const repository = new SqliteTaskRepository(filename)
    const service = new TaskMutationService(repository)
    const task: Task = {
      id: 'task-rollback', createdAt: now, updatedAt: now,
      title: 'Не удалять', status: 'todo', priority: 'medium',
    }

    try {
      await repository.save(task)
      const database = new DatabaseSync(filename)
      try {
        database.exec(`
          CREATE TRIGGER reject_task_delete_audit
          BEFORE INSERT ON audit_events
          WHEN NEW.action = 'task.deleted'
          BEGIN SELECT RAISE(ABORT, 'task audit rejected by test trigger'); END
        `)
      } finally {
        database.close()
      }

      await rejects(
        service.delete(task.id, {
          actorType: 'user', actorUserId: 'admin-1', requestId: 'request-3',
        }),
        /task audit rejected by test trigger/,
      )
      equal((await repository.findById(task.id))?.title, 'Не удалять')
      const auditRepository = new SqliteAuditRepository(filename)
      try {
        equal((await auditRepository.findAll()).length, 0)
      } finally {
        auditRepository.close()
      }
    } finally {
      repository.close()
    }
  })
})

test('task import audit failure rolls back every imported row', async () => {
  await withDatabaseFile(async (filename) => {
    initializeDatabase(filename)
    const repository = new SqliteTaskRepository(filename)
    const service = new TaskMutationService(repository)
    try {
      const database = new DatabaseSync(filename)
      try {
        database.exec(`
          CREATE TRIGGER reject_task_import_audit
          BEFORE INSERT ON audit_events
          WHEN NEW.action = 'tasks.imported'
          BEGIN SELECT RAISE(ABORT, 'task import audit rejected by test trigger'); END
        `)
      } finally {
        database.close()
      }
      await rejects(
        service.import([
          { id: 'task-import-1', createdAt: now, updatedAt: now, title: 'Первая', status: 'todo', priority: 'low' },
          { id: 'task-import-2', createdAt: now, updatedAt: now, title: 'Вторая', status: 'completed', priority: 'high' },
        ], {
          actorType: 'user', actorUserId: 'admin-1', requestId: 'request-4',
        }),
        /task import audit rejected by test trigger/,
      )
      equal(await repository.findById('task-import-1'), undefined)
      equal(await repository.findById('task-import-2'), undefined)
    } finally {
      repository.close()
    }
  })
})
