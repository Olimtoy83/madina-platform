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
  TaskMutationService,
  TaskNotFoundError,
  TaskValidationError,
  type Task,
  type TaskRepository,
} from '@madina/core'
import type { FastifyInstance } from 'fastify'
import {
  getAuthenticatedCommandContext,
  requirePermission,
  requireTrustedOrigin,
} from '../../../../plugins/authentication.js'

interface TasksRoutesOptions {
  taskRepository: TaskRepository
  taskMutationService: TaskMutationService
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

function toCreateInput(
  input: CreateTaskRequest,
): Omit<CreateTaskRequest, 'dueDate'> & { dueDate?: Date } {
  return {
    ...input,
    dueDate: parseDueDate(input.dueDate),
  }
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

function toErrorResponse(error: { message: string }) {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message: error.message,
  }
}

function isTaskValidationError(
  error: unknown,
): error is TaskValidationError {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'TaskValidationError' &&
    'message' in error &&
    typeof error.message === 'string'
}

export async function tasksRoutes(
  app: FastifyInstance,
  options: TasksRoutesOptions,
) {
  const {
    taskRepository,
    taskMutationService,
  } = options

  app.get(
    '/',
    {
      preHandler: requirePermission(app, 'tasks:read'),
    },
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
    {
      preHandler: [
        requirePermission(app, 'tasks:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<TaskResponse | ApiErrorResponse> => {
      try {
        const task = await taskMutationService.create(
          toCreateInput(request.body),
          getAuthenticatedCommandContext(request),
        )
        reply.code(201)

        return toTaskResponse(task)
      } catch (error) {
        if (isTaskValidationError(error)) {
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
    {
      preHandler: [
        requirePermission(app, 'data:import'),
        requireTrustedOrigin(),
      ],
    },
    async (
      request,
      reply,
    ): Promise<ImportTasksResponse | ApiErrorResponse> => {
      try {
        const tasks = request.body.tasks.map((input): Task => {
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

          const parsedTask = createTask(toCreateInput({
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate,
          }))

          return {
            ...parsedTask,
            id,
            createdAt,
            updatedAt,
          }
        })

        return await taskMutationService.import(
          tasks,
          getAuthenticatedCommandContext(request),
        )
      } catch (error) {
        if (isTaskValidationError(error)) {
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
    {
      preHandler: [
        requirePermission(app, 'tasks:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<TaskResponse | ApiErrorResponse> => {
      try {
        const updatedTask = await taskMutationService.update(
          request.params.taskId,
          toUpdateInput(request.body),
          getAuthenticatedCommandContext(request),
        )
        return toTaskResponse(updatedTask)
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          reply.code(404)
          return {
            statusCode: 404,
            error: 'Not Found',
            message: error.message,
          }
        }
        if (isTaskValidationError(error)) {
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
    {
      preHandler: [
        requirePermission(app, 'tasks:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<void | ApiErrorResponse> => {
      try {
        await taskMutationService.delete(
          request.params.taskId,
          getAuthenticatedCommandContext(request),
        )
      } catch (error) {
        if (!(error instanceof TaskNotFoundError)) {
          throw error
        }
        reply.code(404)
        return {
          statusCode: 404,
          error: 'Not Found',
          message: 'Task not found',
        }
      }
      reply.code(204)
    },
  )
}
