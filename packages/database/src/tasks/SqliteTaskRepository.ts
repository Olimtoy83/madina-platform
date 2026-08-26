import { DatabaseSync } from 'node:sqlite'
import type {
  Task,
  TaskPriority,
  TaskRepository,
  TaskStatus,
} from '@madina/core'

interface TaskRow {
  id: string
  created_at: string
  updated_at: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
}

function toTask(
  row: TaskRow,
): Task {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date
      ? new Date(row.due_date)
      : undefined,
  }
}

export class SqliteTaskRepository
  implements TaskRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = new DatabaseSync(filename)

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('todo', 'in-progress', 'completed', 'cancelled')
        ),
        priority TEXT NOT NULL CHECK (
          priority IN ('low', 'medium', 'high')
        ),
        due_date TEXT
      )
    `)
  }

  async findAll(): Promise<Task[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, title, description,
        status, priority, due_date
      FROM tasks
      ORDER BY created_at DESC
    `).all() as unknown as TaskRow[]

    return rows.map(toTask)
  }

  async findById(
    taskId: string,
  ): Promise<Task | undefined> {
    const row = this.database.prepare(`
      SELECT id, created_at, updated_at, title, description,
        status, priority, due_date
      FROM tasks WHERE id = ?
    `).get(taskId) as TaskRow | undefined

    return row ? toTask(row) : undefined
  }

  async save(task: Task): Promise<void> {
    this.database.prepare(`
      INSERT INTO tasks (
        id, created_at, updated_at, title, description,
        status, priority, due_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.createdAt.toISOString(),
      task.updatedAt.toISOString(),
      task.title,
      task.description ?? null,
      task.status,
      task.priority,
      task.dueDate?.toISOString() ?? null,
    )
  }

  async update(task: Task): Promise<void> {
    this.database.prepare(`
      UPDATE tasks SET
        created_at = ?, updated_at = ?, title = ?, description = ?,
        status = ?, priority = ?, due_date = ?
      WHERE id = ?
    `).run(
      task.createdAt.toISOString(),
      task.updatedAt.toISOString(),
      task.title,
      task.description ?? null,
      task.status,
      task.priority,
      task.dueDate?.toISOString() ?? null,
      task.id,
    )
  }

  async delete(taskId: string): Promise<void> {
    this.database.prepare(
      'DELETE FROM tasks WHERE id = ?',
    ).run(taskId)
  }

  close(): void {
    this.database.close()
  }
}
