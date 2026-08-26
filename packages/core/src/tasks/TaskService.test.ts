import { describe, expect, it } from 'vitest'
import type { Task } from './types/task'
import {
  createTask,
  getTaskStats,
  TaskValidationError,
  updateTask,
} from './TaskService'

function createTaskFixture(
  status: Task['status'],
): Task {
  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    title: 'Test Task',
    status,
    priority: 'medium',
  }
}

describe('getTaskStats', () => {
  it('calculates task statistics', () => {
    const tasks = [
      createTaskFixture('todo'),
      createTaskFixture('todo'),
      createTaskFixture('in-progress'),
      createTaskFixture('completed'),
      createTaskFixture('cancelled'),
    ]

    expect(
      getTaskStats(tasks),
    ).toEqual({
      total: 5,
      todo: 2,
      inProgress: 1,
      completed: 1,
    })
  })

  it('returns zero statistics for empty input', () => {
    expect(
      getTaskStats([]),
    ).toEqual({
      total: 0,
      todo: 0,
      inProgress: 0,
      completed: 0,
    })
  })

  it('does not count cancelled tasks as completed', () => {
    const tasks = [
      createTaskFixture('cancelled'),
      createTaskFixture('completed'),
    ]

    expect(
      getTaskStats(tasks),
    ).toEqual({
      total: 2,
      todo: 0,
      inProgress: 0,
      completed: 1,
    })
  })
})

describe('task mutation services', () => {
  it('creates a normalized task', () => {
    const task = createTask({
      title: '  Позвонить поставщику  ',
      description: '  Подтвердить заказ  ',
      status: 'todo',
      priority: 'high',
    })

    expect(task).toMatchObject({
      title: 'Позвонить поставщику',
      description: 'Подтвердить заказ',
      status: 'todo',
      priority: 'high',
    })
  })

  it('rejects a task without a title', () => {
    expect(() => createTask({
      title: '   ',
      status: 'todo',
      priority: 'medium',
    })).toThrow(TaskValidationError)
  })

  it('updates only specified task fields', () => {
    const task = createTask({
      title: 'Старое название',
      status: 'todo',
      priority: 'low',
    })

    const updated = updateTask(task, {
      status: 'completed',
    })

    expect(updated).toMatchObject({
      id: task.id,
      title: 'Старое название',
      status: 'completed',
      priority: 'low',
    })
  })
})
