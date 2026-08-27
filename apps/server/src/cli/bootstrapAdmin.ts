import { randomUUID } from 'node:crypto'
import {
  hashPassword,
  validateUsername,
} from '@madina/auth'
import type { AuthRepository } from '@madina/auth'

export class FirstAdminAlreadyExistsError extends Error {
  constructor() {
    super('A user already exists. First admin bootstrap is unavailable.')
    this.name = 'FirstAdminAlreadyExistsError'
  }
}

export class PasswordConfirmationMismatchError extends Error {
  constructor() {
    super('Password confirmation does not match.')
    this.name = 'PasswordConfirmationMismatchError'
  }
}

export interface BootstrapAdminInput {
  username: string
  password: string
  passwordConfirmation: string
}

export interface BootstrappedAdmin {
  id: string
  username: string
}

export async function bootstrapAdmin(
  repository: AuthRepository,
  input: BootstrapAdminInput,
  now = new Date(),
): Promise<BootstrappedAdmin> {
  if (input.password !== input.passwordConfirmation) {
    throw new PasswordConfirmationMismatchError()
  }

  const normalizedUsername = validateUsername(input.username)
  const passwordHash = await hashPassword(input.password)
  const id = randomUUID()
  const username = input.username.trim()
  const user = {
    id,
    username,
    normalizedUsername,
    role: 'admin' as const,
    status: 'active' as const,
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
  const credential = {
    userId: id,
    ...passwordHash,
    passwordChangedAt: now,
  }

  const created = await repository.createFirstAdmin(user, credential)

  if (!created) {
    throw new FirstAdminAlreadyExistsError()
  }

  return {
    id,
    username,
  }
}
