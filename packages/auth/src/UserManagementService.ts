import { randomUUID } from 'node:crypto'
import type { AuthRepository } from './repositories/AuthRepository.js'
import { hashPassword } from './passwords/scrypt.js'
import { validateUsername } from './usernames.js'
import type { User, UserRole, UserStatus } from './types.js'
import type { AuditEvent, CommandContext } from '@madina/shared'

const userRoles: readonly UserRole[] = ['admin', 'manager', 'operator', 'viewer']
const userStatuses: readonly UserStatus[] = ['active', 'inactive']

export class UserManagementValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserManagementValidationError'
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found.')
    this.name = 'UserNotFoundError'
  }
}

export class DuplicateUserError extends Error {
  constructor() {
    super('A user with the same username or email already exists.')
    this.name = 'DuplicateUserError'
  }
}

export class LastActiveAdminError extends Error {
  constructor() {
    super('The last active admin cannot be changed.')
    this.name = 'LastActiveAdminError'
  }
}

export interface CreateManagedUserInput {
  username: string
  email?: string
  role: UserRole
  initialPassword: string
}

export interface UpdateManagedUserInput {
  role?: UserRole
  status?: UserStatus
}

function validateRole(role: string): asserts role is UserRole {
  if (!userRoles.includes(role as UserRole)) {
    throw new UserManagementValidationError('User role is invalid.')
  }
}

function validateStatus(status: string): asserts status is UserStatus {
  if (!userStatuses.includes(status as UserStatus)) {
    throw new UserManagementValidationError('User status is invalid.')
  }
}

function normalizeEmail(email: string | undefined): string | undefined {
  if (email === undefined) return undefined

  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail) return undefined

  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)
  ) {
    throw new UserManagementValidationError('User email is invalid.')
  }

  return normalizedEmail
}

async function ensureNotLastActiveAdmin(
  repository: AuthRepository,
  currentUser: User,
  nextUser: User,
): Promise<void> {
  const removesActiveAdmin = currentUser.role === 'admin' &&
    currentUser.status === 'active' &&
    (nextUser.role !== 'admin' || nextUser.status !== 'active')

  if (!removesActiveAdmin) return

  const activeAdminCount = (await repository.findAllUsers()).filter((user) =>
    user.role === 'admin' && user.status === 'active'
  ).length

  if (activeAdminCount <= 1) {
    throw new LastActiveAdminError()
  }
}

export class UserManagementService {
  constructor(private readonly repository: AuthRepository) {}

  async listUsers(): Promise<User[]> {
    return this.repository.findAllUsers()
  }

  async createUser(
    input: CreateManagedUserInput,
    context: CommandContext,
    now = new Date(),
  ): Promise<User> {
    validateRole(input.role)
    const normalizedUsername = validateUsername(input.username)
    const email = normalizeEmail(input.email)
    const passwordHash = await hashPassword(input.initialPassword)
    const user: User = {
      id: randomUUID(),
      username: input.username.trim(),
      normalizedUsername,
      email,
      role: input.role,
      status: 'active',
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    }

    await this.repository.withUserManagementTransaction(async (unitOfWork) => {
      const matchingUsername = await unitOfWork.findUserByNormalizedUsername(
        normalizedUsername,
      )
      const matchingEmail = email
        ? await unitOfWork.findUserByEmail(email)
        : undefined

      if (matchingUsername || matchingEmail) {
        throw new DuplicateUserError()
      }

      await unitOfWork.createUser(user)
      await unitOfWork.saveCredential({
        userId: user.id,
        ...passwordHash,
        passwordChangedAt: now,
      })
      await appendUserAudit(unitOfWork, context, 'user.created', user.id, {
        role: user.role,
      })
    })

    return user
  }

  async updateUser(
    userId: string,
    input: UpdateManagedUserInput,
    context: CommandContext,
    now = new Date(),
  ): Promise<User> {
    if (input.role === undefined && input.status === undefined) {
      throw new UserManagementValidationError('No user changes were provided.')
    }

    if (input.role !== undefined) validateRole(input.role)
    if (input.status !== undefined) validateStatus(input.status)

    return this.repository.withUserManagementTransaction(async (unitOfWork) => {
      const currentUser = await unitOfWork.findUserById(userId)

      if (!currentUser) throw new UserNotFoundError()

      const nextUser: User = {
        ...currentUser,
        role: input.role ?? currentUser.role,
        status: input.status ?? currentUser.status,
        updatedAt: now,
      }
      const roleChanged = nextUser.role !== currentUser.role
      const statusChanged = nextUser.status !== currentUser.status

      if (!roleChanged && !statusChanged) return currentUser

      const invalidatesSessions = nextUser.role !== currentUser.role ||
        (currentUser.status === 'active' && nextUser.status === 'inactive')

      await ensureNotLastActiveAdmin(unitOfWork, currentUser, nextUser)

      if (invalidatesSessions) nextUser.sessionVersion += 1

      await unitOfWork.updateUser(nextUser)

      if (invalidatesSessions) {
        await unitOfWork.revokeSessionsByUserId(userId, now)
      }

      if (roleChanged) {
        await appendUserAudit(unitOfWork, context, 'user.role_changed', userId, {
          from: currentUser.role,
          to: nextUser.role,
        })
      }

      if (statusChanged) {
        await appendUserAudit(unitOfWork, context, 'user.status_changed', userId, {
          from: currentUser.status,
          to: nextUser.status,
        })
      }

      return nextUser
    })
  }

  async resetPassword(
    userId: string,
    password: string,
    context: CommandContext,
    now = new Date(),
  ): Promise<void> {
    const passwordHash = await hashPassword(password)

    await this.repository.withUserManagementTransaction(async (unitOfWork) => {
      const user = await unitOfWork.findUserById(userId)

      if (!user) throw new UserNotFoundError()

      await unitOfWork.saveCredential({
        userId,
        ...passwordHash,
        passwordChangedAt: now,
      })
      await unitOfWork.updateUser({
        ...user,
        sessionVersion: user.sessionVersion + 1,
        updatedAt: now,
      })
      await unitOfWork.revokeSessionsByUserId(userId, now)
      await appendUserAudit(unitOfWork, context, 'user.password_reset', userId)
    })
  }

  async revokeSessions(
    userId: string,
    context: CommandContext,
    now = new Date(),
  ): Promise<void> {
    await this.repository.withUserManagementTransaction(async (unitOfWork) => {
      const user = await unitOfWork.findUserById(userId)

      if (!user) throw new UserNotFoundError()

      await unitOfWork.updateUser({
        ...user,
        sessionVersion: user.sessionVersion + 1,
        updatedAt: now,
      })
      await unitOfWork.revokeSessionsByUserId(userId, now)
      await appendUserAudit(unitOfWork, context, 'user.sessions_revoked', userId)
    })
  }
}

async function appendUserAudit(
  repository: AuthRepository,
  context: CommandContext,
  action: AuditEvent['action'],
  userId: string,
  metadata?: AuditEvent['metadata'],
): Promise<void> {
  await repository.appendAuditEvent({
    id: randomUUID(),
    occurredAt: new Date(),
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    domain: 'users',
    entityType: 'user',
    entityId: userId,
    action,
    metadata,
  })
}
