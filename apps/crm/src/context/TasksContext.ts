import { createContext } from 'react'
import type { Task } from '../entities/task'

export interface TasksContextValue {
  tasks: Task[]

  addTask: (
    task: Task,
  ) => void

  updateTask: (
    taskId: string,
    updates: Partial<Task>,
  ) => void

  deleteTask: (
    taskId: string,
  ) => void

  getTasksByStatus: (
    status: Task['status'],
  ) => Task[]
}

export const TasksContext =
  createContext<TasksContextValue | null>(null)
