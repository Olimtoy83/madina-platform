import type { Task } from './types/task'

export interface CreateTaskInput {
  title: string
  description?: string
  status: Task['status']
  priority: Task['priority']
  dueDate?: Date
}

export type UpdateTaskInput =
  Partial<CreateTaskInput>

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskValidationError'
  }
}

function normalizeOptionalText(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim()

  return normalized || undefined
}

function validateStatus(
  status: Task['status'],
): void {
  if (
    status !== 'todo' &&
    status !== 'in-progress' &&
    status !== 'completed' &&
    status !== 'cancelled'
  ) {
    throw new TaskValidationError(
      'Статус задачи недопустим.',
    )
  }
}

function validatePriority(
  priority: Task['priority'],
): void {
  if (
    priority !== 'low' &&
    priority !== 'medium' &&
    priority !== 'high'
  ) {
    throw new TaskValidationError(
      'Приоритет задачи недопустим.',
    )
  }
}

function validateDueDate(
  dueDate: Date | undefined,
): void {
  if (
    dueDate &&
    Number.isNaN(dueDate.getTime())
  ) {
    throw new TaskValidationError(
      'Срок выполнения задачи недопустим.',
    )
  }
}

export function createTask(
  input: CreateTaskInput,
): Task {
  const title = input.title.trim()

  if (!title) {
    throw new TaskValidationError(
      'Название задачи обязательно.',
    )
  }

  validateStatus(input.status)
  validatePriority(input.priority)
  validateDueDate(input.dueDate)

  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    title,
    description: normalizeOptionalText(
      input.description,
    ),
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate,
  }
}

export function updateTask(
  task: Task,
  updates: UpdateTaskInput,
): Task {
  const nextTask: Task = {
    ...task,
    updatedAt: new Date(),
  }

  if (Object.hasOwn(updates, 'title')) {
    const title = updates.title?.trim()

    if (!title) {
      throw new TaskValidationError(
        'Название задачи обязательно.',
      )
    }

    nextTask.title = title
  }

  if (Object.hasOwn(updates, 'description')) {
    nextTask.description = normalizeOptionalText(
      updates.description,
    )
  }

  if (
    Object.hasOwn(updates, 'status') &&
    updates.status !== undefined
  ) {
    validateStatus(updates.status)
    nextTask.status = updates.status
  }

  if (
    Object.hasOwn(updates, 'priority') &&
    updates.priority !== undefined
  ) {
    validatePriority(updates.priority)
    nextTask.priority = updates.priority
  }

  if (Object.hasOwn(updates, 'dueDate')) {
    validateDueDate(updates.dueDate)
    nextTask.dueDate = updates.dueDate
  }

  return nextTask
}

export interface TaskStats {
  total: number
  todo: number
  inProgress: number
  completed: number
}

export function getTaskStats(
  tasks: Task[],
): TaskStats {
  return {
    total: tasks.length,

    todo: tasks.filter(
      (task) => task.status === 'todo',
    ).length,

    inProgress: tasks.filter(
      (task) => task.status === 'in-progress',
    ).length,

    completed: tasks.filter(
      (task) => task.status === 'completed',
    ).length,
  }
}
