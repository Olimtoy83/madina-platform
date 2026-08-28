import type { CommandContext } from '@madina/shared'
import type {
  TaskRepository,
  TaskUnitOfWork,
} from './repositories/TaskRepository.js'
import type { Task } from './types/task.js'
import {
  createTask,
  type CreateTaskInput,
  TaskValidationError,
  updateTask,
  type UpdateTaskInput,
} from './TaskService.js'

export class TaskNotFoundError extends Error {
  constructor() {
    super('Task not found')
    this.name = 'TaskNotFoundError'
  }
}

export interface TaskImportResult {
  created: number
  updated: number
}

export class TaskMutationService {
  private readonly repository: TaskRepository

  constructor(repository: TaskRepository) {
    this.repository = repository
  }

  async create(
    input: CreateTaskInput,
    context: CommandContext,
  ): Promise<Task> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const task = createTask(input)
      await unitOfWork.save(task)
      await appendTaskAudit(unitOfWork, context, 'task.created', task.id)
      return task
    })
  }

  async update(
    taskId: string,
    updates: UpdateTaskInput,
    context: CommandContext,
  ): Promise<Task> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const task = await unitOfWork.findById(taskId)
      if (!task) throw new TaskNotFoundError()

      const updatedTask = updateTask(task, updates)
      await unitOfWork.update(updatedTask)
      await appendTaskAudit(unitOfWork, context, 'task.updated', updatedTask.id)
      return updatedTask
    })
  }

  async delete(
    taskId: string,
    context: CommandContext,
  ): Promise<void> {
    await this.repository.withTransaction(async (unitOfWork) => {
      const task = await unitOfWork.findById(taskId)
      if (!task) throw new TaskNotFoundError()

      await unitOfWork.delete(task.id)
      await appendTaskAudit(unitOfWork, context, 'task.deleted', task.id)
    })
  }

  async import(
    tasks: readonly Task[],
    context: CommandContext,
  ): Promise<TaskImportResult> {
    assertUniqueTaskIds(tasks)
    return this.repository.withTransaction(async (unitOfWork) => {
      let created = 0
      let updated = 0
      for (const task of tasks) {
        if (await unitOfWork.findById(task.id)) {
          await unitOfWork.update(task)
          updated += 1
        } else {
          await unitOfWork.save(task)
          created += 1
        }
      }
      await appendTaskAudit(unitOfWork, context, 'tasks.imported', 'tasks-import', {
        created,
        updated,
        total: tasks.length,
      })
      return { created, updated }
    })
  }
}

function assertUniqueTaskIds(tasks: readonly Task[]): void {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new TaskValidationError(`Duplicate task id: ${task.id}`)
    }
    ids.add(task.id)
  }
}

async function appendTaskAudit(
  unitOfWork: TaskUnitOfWork,
  context: CommandContext,
  action: 'task.created' | 'task.updated' | 'task.deleted' | 'tasks.imported',
  entityId: string,
  metadata?: { created: number; updated: number; total: number },
): Promise<void> {
  await unitOfWork.appendAuditEvent({
    id: crypto.randomUUID(),
    occurredAt: new Date(),
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    domain: 'tasks',
    action,
    entityType: action === 'tasks.imported' ? 'task_import' : 'task',
    entityId,
    metadata,
  })
}
