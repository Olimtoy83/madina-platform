import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import type { AuthRepository } from './repositories/AuthRepository.js'
import {
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
} from './passwords/scrypt.js'
import type {
  AuthSession,
  PasswordHash,
  User,
  UserRole,
} from './types.js'

export const SESSION_SECRET_BYTES = 32
export const SESSION_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000
export const SESSION_ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

const dummyPassword = 'dummy authentication password'
let dummyCredentialPromise: Promise<PasswordHash> | undefined

export interface AuthPrincipal {
  id: string
  username: string
  role: UserRole
  sessionId: string
}

export interface LoginSession {
  principal: AuthPrincipal
  sessionSecret: string
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid username or password.')
    this.name = 'InvalidCredentialsError'
  }
}

function toPrincipal(user: User, sessionId: string): AuthPrincipal {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    sessionId,
  }
}

function getDummyCredential(): Promise<PasswordHash> {
  dummyCredentialPromise ??= hashPassword(dummyPassword)
  return dummyCredentialPromise
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds)
}

export function hashSessionSecret(sessionSecret: string): string {
  return createHash('sha256')
    .update(sessionSecret, 'utf8')
    .digest('hex')
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async login(
    username: string,
    password: string,
    now = new Date(),
  ): Promise<LoginSession> {
    const user = await this.repository.findUserByNormalizedUsername(
      normalizeUsername(username),
    )
    const credential = user
      ? await this.repository.findCredentialByUserId(user.id)
      : undefined
    const passwordMatches = credential
      ? await verifyPassword(password, credential)
      : await verifyPassword(password, await getDummyCredential())

    if (!user || !credential || !passwordMatches || user.status !== 'active') {
      throw new InvalidCredentialsError()
    }

    if (needsPasswordRehash(credential)) {
      await this.repository.saveCredential({
        userId: user.id,
        ...await hashPassword(password),
        passwordChangedAt: now,
      })
    }

    const sessionSecret = randomBytes(SESSION_SECRET_BYTES).toString('base64url')
    const session: AuthSession = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionSecret(sessionSecret),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: addMilliseconds(now, SESSION_ABSOLUTE_LIFETIME_MS),
      sessionVersion: user.sessionVersion,
    }
    await this.repository.createSession(session)

    return {
      principal: toPrincipal(user, session.id),
      sessionSecret,
    }
  }

  async authenticate(
    sessionSecret: string,
    now = new Date(),
  ): Promise<AuthPrincipal | undefined> {
    const session = await this.repository.findSessionByTokenHash(
      hashSessionSecret(sessionSecret),
    )

    if (!session || session.revokedAt || session.expiresAt <= now) {
      return undefined
    }

    if (session.lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_MS <= now.getTime()) {
      return undefined
    }

    const user = await this.repository.findUserById(session.userId)

    if (
      !user ||
      user.status !== 'active' ||
      user.sessionVersion !== session.sessionVersion
    ) {
      return undefined
    }

    const refreshedSession: AuthSession = {
      ...session,
      lastSeenAt: now,
    }
    await this.repository.updateSession(refreshedSession)

    return toPrincipal(user, session.id)
  }

  async logout(sessionSecret: string, now = new Date()): Promise<void> {
    const session = await this.repository.findSessionByTokenHash(
      hashSessionSecret(sessionSecret),
    )

    if (session && !session.revokedAt) {
      await this.repository.revokeSession(session.id, now)
    }
  }
}
