import type {
  CreateTaskRequest,
  ImportTasksRequest,
  ImportTasksResponse,
  TaskResponse,
  TasksListResponse,
  UpdateTaskRequest,
} from '@madina/api'
import { requestJson } from './httpClient'

const tasksUrl = '/api/v1/tasks'

export async function getTasks(): Promise<TaskResponse[]> {
  const response = await requestJson<TasksListResponse>(tasksUrl)

  return response.tasks
}

export function createTask(
  input: CreateTaskRequest,
): Promise<TaskResponse> {
  return requestJson<TaskResponse>(tasksUrl, {
    method: 'POST',
    body: input,
  })
}

export function updateTask(
  taskId: string,
  input: UpdateTaskRequest,
): Promise<TaskResponse> {
  return requestJson<TaskResponse>(
    `${tasksUrl}/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body: input },
  )
}

export function deleteTask(taskId: string): Promise<void> {
  return requestJson<void>(
    `${tasksUrl}/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
}

export function importTasks(
  input: ImportTasksRequest,
): Promise<ImportTasksResponse> {
  return requestJson<ImportTasksResponse>(
    `${tasksUrl}/import`,
    { method: 'POST', body: input },
  )
}
