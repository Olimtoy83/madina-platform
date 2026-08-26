import type {
  ImportTaskRequest,
  ImportTasksResponse,
} from '@madina/api'
import { importTasks } from '../api/tasksApi'

const TASKS_STORAGE_KEY = 'madina-crm:v1:tasks'
const MIGRATION_MARKER_KEY =
  'madina-crm:migration:tasks-to-server:v1'

interface StoredTask {
  id: string
  createdAt: string
  updatedAt: string
  title: string
  description?: string
  status: 'todo' | 'in-progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
}

export interface TaskServerBootstrapResult {
  skipped: boolean
  imported: number
  created: number
  updated: number
}

function loadStoredTasks(): StoredTask[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(TASKS_STORAGE_KEY) ?? '[]',
    )

    return Array.isArray(value)
      ? value as StoredTask[]
      : []
  } catch {
    return []
  }
}

function hasMigrationMarker(): boolean {
  try {
    return localStorage.getItem(MIGRATION_MARKER_KEY) === 'done'
  } catch {
    return false
  }
}

function saveMigrationMarker(): void {
  localStorage.setItem(MIGRATION_MARKER_KEY, 'done')
}

export async function bootstrapTasksToServer(): Promise<TaskServerBootstrapResult> {
  if (hasMigrationMarker()) {
    return { skipped: true, imported: 0, created: 0, updated: 0 }
  }

  const storedTasks = loadStoredTasks()

  if (storedTasks.length === 0) {
    saveMigrationMarker()
    return { skipped: false, imported: 0, created: 0, updated: 0 }
  }

  const response: ImportTasksResponse = await importTasks({
    tasks: storedTasks as ImportTaskRequest[],
  })

  saveMigrationMarker()

  return {
    skipped: false,
    imported: storedTasks.length,
    created: response.created,
    updated: response.updated,
  }
}
