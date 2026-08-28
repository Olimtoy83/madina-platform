import type { Task } from '../types/task'
import type { AuditEvent } from '@madina/shared'

export interface TaskReadRepository {
  findAll(): Promise<Task[]>
  findById(
    taskId: string,
  ): Promise<Task | undefined>
}

export interface TaskUnitOfWork
  extends TaskReadRepository {
  save(
    task: Task,
  ): Promise<void>
  update(
    task: Task,
  ): Promise<void>
  delete(
    taskId: string,
  ): Promise<void>
  appendAuditEvent(event: AuditEvent): Promise<void>
}

export interface TaskRepository
  extends TaskReadRepository {
  withTransaction<T>(
    operation: (
      unitOfWork: TaskUnitOfWork,
    ) => Promise<T>,
  ): Promise<T>
}
