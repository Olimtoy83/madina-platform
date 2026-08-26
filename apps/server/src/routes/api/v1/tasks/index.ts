import type {
  ApiErrorResponse,
  CreateTaskRequest,
  ImportTasksRequest,
  ImportTasksResponse,
  TaskResponse,
  TasksListResponse,
  UpdateTaskRequest,
} from '@madina/api'
import {
  createTask,
  TaskValidationError,
  updateTask,
  type Task,
  type TaskRepository,
} from '@madina/core'
import type { FastifyInstance } from 'fastify'

interface TasksRoutesOptions {
  taskRepository: TaskRepository
}

interface TaskParams {
  taskId: string
}

function toTaskResponse(
  task: Task,
): TaskResponse {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate?.toISOString(),
  }
}

function parseDueDate(
  dueDate: string | undefined,
): Date | undefined {
  return dueDate
    ? new Date(dueDate)
    : undefined
}

function toTask(
  input: CreateTaskRequest,
): Task {
  return createTask({
    ...input,
    dueDate: parseDueDate(input.dueDate),
  })
}

function toUpdateInput(
  input: UpdateTaskRequest,
) {
  const { dueDate, ...updates } = input

  if (Object.hasOwn(input, 'dueDate')) {
    return {
      ...updates,
      dueDate: parseDueDate(dueDate),
    }
  }

  return updates
}

function toErrorResponse(error: TaskValidationError) {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message: error.message,
  }
}

export async function tasksRoutes(
  app: FastifyInstance,
  options: TasksRoutesOptions,
) {
  const { taskRepository } = options

  app.get(
    '/',
    async (): Promise<TasksListResponse> => ({
      tasks: (await taskRepository.findAll()).map(
        toTaskResponse,
      ),
    }),
  )

  app.post<{
    Body: CreateTaskRequest
  }>(
    '/',
    async (request, reply): Promise<TaskResponse | ApiErrorResponse> => {
      try {
        const task = toTask(request.body)

        await taskRepository.save(task)
        reply.code(201)

        return toTaskResponse(task)
      } catch (error) {
        if (error instanceof TaskValidationError) {
          reply.code(400)
          return toErrorResponse(error)
        }

        throw error
      }
    },
  )

  app.post<{
    Body: ImportTasksRequest
  }>(
    '/import',
    async (
      request,
      reply,
    ): Promise<ImportTasksResponse | ApiErrorResponse> => {
      try {
        let created = 0
        let updated = 0

        for (const input of request.body.tasks) {
          const id = input.id.trim()
          const createdAt = new Date(input.createdAt)
          const updatedAt = new Date(input.updatedAt)

          if (!id) {
            throw new TaskValidationError(
              'Task id is required.',
            )
          }

          if (
            Number.isNaN(createdAt.getTime()) ||
            Number.isNaN(updatedAt.getTime())
          ) {
            throw new TaskValidationError(
              'Task dates are invalid.',
            )
          }

          const task = toTask({
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate,
          })

          const importedTask: Task = {
            ...task,
            id,
            createdAt,
            updatedAt,
          }

          const existing = await taskRepository.findById(id)

          if (existing) {
            await taskRepository.update(importedTask)
            updated += 1
          } else {
            await taskRepository.save(importedTask)
            created += 1
          }
        }

        return { created, updated }
      } catch (error) {
        if (error instanceof TaskValidationError) {
          reply.code(400)
          return toErrorResponse(error)
        }

        throw error
      }
    },
  )

  app.patch<{
    Params: TaskParams
    Body: UpdateTaskRequest
  }>(
    '/:taskId',
    async (request, reply): Promise<TaskResponse | ApiErrorResponse> => {
      const task = await taskRepository.findById(
        request.params.taskId,
      )

      if (!task) {
        reply.code(404)
        return {
          statusCode: 404,
          error: 'Not Found',
          message: 'Task not found',
        }
      }

      try {
        const updatedTask = updateTask(
          task,
          toUpdateInput(request.body),
        )

        await taskRepository.update(updatedTask)

        return toTaskResponse(updatedTask)
      } catch (error) {
        if (error instanceof TaskValidationError) {
          reply.code(400)
          return toErrorResponse(error)
        }

        throw error
      }
    },
  )

  app.delete<{
    Params: TaskParams
  }>(
    '/:taskId',
    async (request, reply): Promise<void | ApiErrorResponse> => {
      const task = await taskRepository.findById(
        request.params.taskId,
      )

      if (!task) {
        reply.code(404)
        return {
          statusCode: 404,
          error: 'Not Found',
          message: 'Task not found',
        }
      }

      await taskRepository.delete(task.id)
      reply.code(204)
    },
  )
}
