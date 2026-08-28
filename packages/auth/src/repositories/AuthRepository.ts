import type {
  AuthSession,
  PasswordCredential,
  User,
} from '../types.js'
import type { AuditEvent } from '@madina/shared'

export interface AuthRepository {
  findAllUsers(): Promise<User[]>
  findUserById(userId: string): Promise<User | undefined>
  findUserByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<User | undefined>
  findUserByEmail(email: string): Promise<User | undefined>
  createUser(user: User): Promise<void>
  createFirstAdmin(
    user: User,
    credential: PasswordCredential,
    auditEvent: AuditEvent,
  ): Promise<boolean>
  updateUser(user: User): Promise<void>
  findCredentialByUserId(
    userId: string,
  ): Promise<PasswordCredential | undefined>
  saveCredential(credential: PasswordCredential): Promise<void>
  findSessionById(sessionId: string): Promise<AuthSession | undefined>
  findSessionByTokenHash(
    tokenHash: string,
  ): Promise<AuthSession | undefined>
  createSession(session: AuthSession): Promise<void>
  updateSession(session: AuthSession): Promise<void>
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>
  revokeSessionsByUserId(userId: string, revokedAt: Date): Promise<void>
  appendAuditEvent(event: AuditEvent): Promise<void>
  withUserManagementTransaction<T>(
    operation: (unitOfWork: AuthRepository) => Promise<T>,
  ): Promise<T>
}
