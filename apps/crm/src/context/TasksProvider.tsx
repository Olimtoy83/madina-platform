import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Task } from '@madina/core'
import type { TaskResponse, UpdateTaskRequest } from '@madina/api'
import {
  createTask as createTaskApi,
  deleteTask as deleteTaskApi,
  getTasks,
  updateTask as updateTaskApi,
} from '../shared/api/tasksApi'
import { TasksContext } from './TasksContext'

interface TasksProviderProps {
  children: ReactNode
}

function toTask(response: TaskResponse): Task {
  return {
    ...response,
    createdAt: new Date(response.createdAt),
    updatedAt: new Date(response.updatedAt),
    dueDate: response.dueDate
      ? new Date(response.dueDate)
      : undefined,
  }
}

export function TasksProvider({ children }: TasksProviderProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const responses = await getTasks()

        if (!cancelled) {
          setTasks(responses.map(toTask))
          setLoadError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error
            ? error
            : new Error('Не удалось загрузить задачи.'))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const addTask = useCallback(async (task: Task): Promise<Task> => {
    const savedTask = toTask(await createTaskApi({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate?.toISOString(),
    }))

    setTasks((currentTasks) => [savedTask, ...currentTasks])

    return savedTask
  }, [])

  const updateTask = useCallback(async (
    taskId: string,
    updates: Partial<Task>,
  ): Promise<Task> => {
    const request: UpdateTaskRequest = {}

    if (updates.title !== undefined) {
      request.title = updates.title
    }

    if (updates.description !== undefined) {
      request.description = updates.description
    }

    if (updates.status !== undefined) {
      request.status = updates.status
    }

    if (updates.priority !== undefined) {
      request.priority = updates.priority
    }

    if (Object.hasOwn(updates, 'dueDate')) {
      request.dueDate = updates.dueDate?.toISOString()
    }

    const savedTask = toTask(await updateTaskApi(taskId, request))

    setTasks((currentTasks) => currentTasks.map((task) =>
      task.id === savedTask.id ? savedTask : task,
    ))

    return savedTask
  }, [])

  const deleteTask = useCallback(async (taskId: string): Promise<void> => {
    await deleteTaskApi(taskId)
    setTasks((currentTasks) => currentTasks.filter(
      (task) => task.id !== taskId,
    ))
  }, [])

  const getTasksByStatus = useCallback(
    (status: Task['status']) => tasks.filter(
      (task) => task.status === status,
    ),
    [tasks],
  )

  const value = useMemo(() => ({
    tasks,
    isLoading,
    loadError,
    addTask,
    updateTask,
    deleteTask,
    getTasksByStatus,
  }), [
    tasks,
    isLoading,
    loadError,
    addTask,
    updateTask,
    deleteTask,
    getTasksByStatus,
  ])

  return (
    <TasksContext.Provider value={value}>
      {children}
    </TasksContext.Provider>
  )
}
