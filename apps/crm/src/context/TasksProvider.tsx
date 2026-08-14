import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Task } from '@madina/core'
import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { TasksContext } from './TasksContext'

interface TasksProviderProps {
  children: ReactNode
}

type StoredTask = Omit<
  Task,
  'createdAt' | 'updatedAt' | 'dueDate'
> & {
  createdAt: string
  updatedAt: string
  dueDate?: string
}

const STORAGE_KEY = 'tasks'

function restoreTask(
  task: StoredTask,
): Task {
  return {
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    dueDate: task.dueDate
      ? new Date(task.dueDate)
      : undefined,
  }
}

function loadTasks(): Task[] {
  const storedTasks =
    loadStorage<StoredTask[]>(
      STORAGE_KEY,
      [],
    )

  return storedTasks.map(restoreTask)
}

export function TasksProvider({
  children,
}: TasksProviderProps) {
  const [tasks, setTasks] =
    useState<Task[]>(loadTasks)

  const addTask = useCallback(
    (task: Task) => {
      setTasks((currentTasks) => {
        const nextTasks = [
          task,
          ...currentTasks,
        ]

        saveStorage(
          STORAGE_KEY,
          nextTasks,
        )

        return nextTasks
      })
    },
    [],
  )

  const updateTask = useCallback(
    (
      taskId: string,
      updates: Partial<Task>,
    ) => {
      setTasks((currentTasks) => {
        const nextTasks =
          currentTasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  ...updates,
                  updatedAt: new Date(),
                }
              : task,
          )

        saveStorage(
          STORAGE_KEY,
          nextTasks,
        )

        return nextTasks
      })
    },
    [],
  )

  const deleteTask = useCallback(
    (taskId: string) => {
      setTasks((currentTasks) => {
        const nextTasks =
          currentTasks.filter(
            (task) => task.id !== taskId,
          )

        saveStorage(
          STORAGE_KEY,
          nextTasks,
        )

        return nextTasks
      })
    },
    [],
  )

  const getTasksByStatus = useCallback(
    (status: Task['status']) =>
      tasks.filter(
        (task) =>
          task.status === status,
      ),
    [tasks],
  )

  const value = useMemo(
    () => ({
      tasks,
      addTask,
      updateTask,
      deleteTask,
      getTasksByStatus,
    }),
    [
      tasks,
      addTask,
      updateTask,
      deleteTask,
      getTasksByStatus,
    ],
  )

  return (
    <TasksContext.Provider value={value}>
      {children}
    </TasksContext.Provider>
  )
}
