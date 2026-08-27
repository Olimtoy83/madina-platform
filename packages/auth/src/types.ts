export type UserRole =
  | 'admin'
  | 'manager'
  | 'operator'
  | 'viewer'

export type UserStatus =
  | 'active'
  | 'inactive'

export interface User {
  id: string
  username: string
  normalizedUsername: string
  email?: string
  role: UserRole
  status: UserStatus
  sessionVersion: number
  createdAt: Date
  updatedAt: Date
}

export interface PasswordHash {
  algorithm: string
  version: number
  N: number
  r: number
  p: number
  keyLength: number
  salt: string
  hash: string
}

export interface PasswordCredential extends PasswordHash {
  userId: string
  passwordChangedAt: Date
}

export interface AuthSession {
  id: string
  userId: string
  tokenHash: string
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  revokedAt?: Date
  sessionVersion: number
}
