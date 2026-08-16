import type { Task } from './types/task'

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
