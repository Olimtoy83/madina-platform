import { createContext } from 'react'
import type { Task } from '@madina/core'

export interface TasksContextValue {
  tasks: Task[]
  isLoading: boolean
  loadError: Error | null

  addTask: (
    task: Task,
  ) => Promise<Task>

  updateTask: (
    taskId: string,
    updates: Partial<Task>,
  ) => Promise<Task>

  deleteTask: (
    taskId: string,
  ) => Promise<void>

  getTasksByStatus: (
    status: Task['status'],
  ) => Task[]
}

export const TasksContext =
  createContext<TasksContextValue | null>(null)
