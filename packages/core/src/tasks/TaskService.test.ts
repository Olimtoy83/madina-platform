import { describe, expect, it } from 'vitest'
import type { Task } from './types/task'
import { getTaskStats } from './TaskService'

function createTask(
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
      createTask('todo'),
      createTask('todo'),
      createTask('in-progress'),
      createTask('completed'),
      createTask('cancelled'),
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
      createTask('cancelled'),
      createTask('completed'),
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
