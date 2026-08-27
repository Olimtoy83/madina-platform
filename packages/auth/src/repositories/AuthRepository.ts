import type {
  AuthSession,
  PasswordCredential,
  User,
} from '../types.js'

export interface AuthRepository {
  findUserById(userId: string): Promise<User | undefined>
  findUserByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<User | undefined>
  createUser(user: User): Promise<void>
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
}
