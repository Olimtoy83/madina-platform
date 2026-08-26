export type TaskStatus =
  | 'todo'
  | 'in-progress'
  | 'completed'
  | 'cancelled'

export type TaskPriority =
  | 'low'
  | 'medium'
  | 'high'

export interface CreateTaskRequest {
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  dueDate?: string
}

export type UpdateTaskRequest =
  Partial<CreateTaskRequest>

export interface ImportTaskRequest extends TaskResponse {}

export interface ImportTasksRequest {
  tasks: ImportTaskRequest[]
}

export interface ImportTasksResponse {
  created: number
  updated: number
}

export interface TaskResponse {
  id: string
  createdAt: string
  updatedAt: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  dueDate?: string
}

export interface TasksListResponse {
  tasks: TaskResponse[]
}
