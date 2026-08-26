import type { Task } from '../types/task'

export interface TaskRepository {
  findAll(): Promise<Task[]>
  findById(
    taskId: string,
  ): Promise<Task | undefined>
  save(
    task: Task,
  ): Promise<void>
  update(
    task: Task,
  ): Promise<void>
  delete(
    taskId: string,
  ): Promise<void>
}
