import type { BaseEntity } from '@madina/shared'

export type TaskStatus =
  | 'todo'
  | 'in-progress'
  | 'completed'
  | 'cancelled'

export type TaskPriority =
  | 'low'
  | 'medium'
  | 'high'

export interface Task extends BaseEntity {
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  dueDate?: Date
}
