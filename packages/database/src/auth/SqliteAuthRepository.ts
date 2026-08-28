import type { DatabaseSync } from 'node:sqlite'
import type {
  AuthRepository,
  AuthSession,
  PasswordCredential,
  User,
  UserRole,
  UserStatus,
} from '@madina/auth'
import type { AuditEvent } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface UserRow {
  id: string
  username: string
  normalized_username: string
  email: string | null
  role: UserRole
  status: UserStatus
  session_version: number
  created_at: string
  updated_at: string
}

interface CredentialRow {
  user_id: string
  password_hash: string
  salt: string
  algorithm: string
  version: number
  scrypt_n: number
  scrypt_r: number
  scrypt_p: number
  key_length: number
  password_changed_at: string
}

interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  created_at: string
  last_seen_at: string
  expires_at: string
  revoked_at: string | null
  session_version: number
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    normalizedUsername: row.normalized_username,
    email: row.email ?? undefined,
    role: row.role,
    status: row.status,
    sessionVersion: row.session_version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toCredential(row: CredentialRow): PasswordCredential {
  return {
    userId: row.user_id,
    hash: row.password_hash,
    salt: row.salt,
    algorithm: row.algorithm,
    version: row.version,
    N: row.scrypt_n,
    r: row.scrypt_r,
    p: row.scrypt_p,
    keyLength: row.key_length,
    passwordChangedAt: new Date(row.password_changed_at),
  }
}

function toSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : undefined,
    sessionVersion: row.session_version,
  }
}

export class SqliteAuthRepository implements AuthRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    appendAuditEvent(this.database, event)
  }

  async findAllUsers(): Promise<User[]> {
    const rows = this.database.prepare(`
      SELECT id, username, normalized_username, email, role, status,
        session_version, created_at, updated_at
      FROM users
      ORDER BY normalized_username, id
    `).all() as unknown as UserRow[]

    return rows.map(toUser)
  }

  async findUserById(userId: string): Promise<User | undefined> {
    const row = this.database.prepare(`
      SELECT id, username, normalized_username, email, role, status,
        session_version, created_at, updated_at
      FROM users WHERE id = ?
    `).get(userId) as UserRow | undefined

    return row ? toUser(row) : undefined
  }

  async findUserByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<User | undefined> {
    const row = this.database.prepare(`
      SELECT id, username, normalized_username, email, role, status,
        session_version, created_at, updated_at
      FROM users WHERE normalized_username = ?
    `).get(normalizedUsername) as UserRow | undefined

    return row ? toUser(row) : undefined
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const row = this.database.prepare(`
      SELECT id, username, normalized_username, email, role, status,
        session_version, created_at, updated_at
      FROM users WHERE email = ?
    `).get(email) as UserRow | undefined

    return row ? toUser(row) : undefined
  }

  async createUser(user: User): Promise<void> {
    this.database.prepare(`
      INSERT INTO users (
        id, username, normalized_username, email, role, status,
        session_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.username,
      user.normalizedUsername,
      user.email ?? null,
      user.role,
      user.status,
      user.sessionVersion,
      user.createdAt.toISOString(),
      user.updatedAt.toISOString(),
    )
  }

  async createFirstAdmin(
    user: User,
    credential: PasswordCredential,
    auditEvent: AuditEvent,
  ): Promise<boolean> {
    this.database.exec('BEGIN IMMEDIATE')

    try {
      const existingUser = this.database.prepare(`
        SELECT 1 FROM users LIMIT 1
      `).get()

      if (existingUser) {
        this.database.exec('COMMIT')
        return false
      }

      await this.createUser(user)
      await this.saveCredential(credential)
      await this.appendAuditEvent(auditEvent)
      this.database.exec('COMMIT')
      return true
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async updateUser(user: User): Promise<void> {
    this.database.prepare(`
      UPDATE users SET
        username = ?, normalized_username = ?, email = ?, role = ?,
        status = ?, session_version = ?, updated_at = ?
      WHERE id = ?
    `).run(
      user.username,
      user.normalizedUsername,
      user.email ?? null,
      user.role,
      user.status,
      user.sessionVersion,
      user.updatedAt.toISOString(),
      user.id,
    )
  }

  async findCredentialByUserId(
    userId: string,
  ): Promise<PasswordCredential | undefined> {
    const row = this.database.prepare(`
      SELECT user_id, password_hash, salt, algorithm, version, scrypt_n,
        scrypt_r, scrypt_p, key_length, password_changed_at
      FROM user_credentials WHERE user_id = ?
    `).get(userId) as CredentialRow | undefined

    return row ? toCredential(row) : undefined
  }

  async saveCredential(credential: PasswordCredential): Promise<void> {
    this.database.prepare(`
      INSERT INTO user_credentials (
        user_id, password_hash, salt, algorithm, version, scrypt_n,
        scrypt_r, scrypt_p, key_length, password_changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        algorithm = excluded.algorithm,
        version = excluded.version,
        scrypt_n = excluded.scrypt_n,
        scrypt_r = excluded.scrypt_r,
        scrypt_p = excluded.scrypt_p,
        key_length = excluded.key_length,
        password_changed_at = excluded.password_changed_at
    `).run(
      credential.userId,
      credential.hash,
      credential.salt,
      credential.algorithm,
      credential.version,
      credential.N,
      credential.r,
      credential.p,
      credential.keyLength,
      credential.passwordChangedAt.toISOString(),
    )
  }

  async findSessionById(sessionId: string): Promise<AuthSession | undefined> {
    const row = this.database.prepare(`
      SELECT id, user_id, token_hash, created_at, last_seen_at, expires_at,
        revoked_at, session_version
      FROM auth_sessions WHERE id = ?
    `).get(sessionId) as SessionRow | undefined

    return row ? toSession(row) : undefined
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<AuthSession | undefined> {
    const row = this.database.prepare(`
      SELECT id, user_id, token_hash, created_at, last_seen_at, expires_at,
        revoked_at, session_version
      FROM auth_sessions WHERE token_hash = ?
    `).get(tokenHash) as SessionRow | undefined

    return row ? toSession(row) : undefined
  }

  async createSession(session: AuthSession): Promise<void> {
    this.database.prepare(`
      INSERT INTO auth_sessions (
        id, user_id, token_hash, created_at, last_seen_at, expires_at,
        revoked_at, session_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.userId,
      session.tokenHash,
      session.createdAt.toISOString(),
      session.lastSeenAt.toISOString(),
      session.expiresAt.toISOString(),
      session.revokedAt?.toISOString() ?? null,
      session.sessionVersion,
    )
  }

  async updateSession(session: AuthSession): Promise<void> {
    this.database.prepare(`
      UPDATE auth_sessions SET
        token_hash = ?, last_seen_at = ?, expires_at = ?, revoked_at = ?,
        session_version = ?
      WHERE id = ?
    `).run(
      session.tokenHash,
      session.lastSeenAt.toISOString(),
      session.expiresAt.toISOString(),
      session.revokedAt?.toISOString() ?? null,
      session.sessionVersion,
      session.id,
    )
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    this.database.prepare(`
      UPDATE auth_sessions SET revoked_at = ? WHERE id = ?
    `).run(revokedAt.toISOString(), sessionId)
  }

  async revokeSessionsByUserId(
    userId: string,
    revokedAt: Date,
  ): Promise<void> {
    this.database.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(revokedAt.toISOString(), userId)
  }

  async withUserManagementTransaction<T>(
    operation: (unitOfWork: AuthRepository) => Promise<T>,
  ): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE')

    try {
      const result = await operation(this)
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.database.close()
  }
}
