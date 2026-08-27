export interface LoginRequest {
  username: string
  password: string
}

export interface AuthUserResponse {
  id: string
  username: string
  role: 'admin' | 'manager' | 'operator' | 'viewer'
}

export interface LoginResponse {
  user: AuthUserResponse
}

export interface MeResponse {
  user: AuthUserResponse
}

export interface LogoutResponse {
  success: true
}

export interface ManagedUserResponse {
  id: string
  username: string
  email?: string
  role: 'admin' | 'manager' | 'operator' | 'viewer'
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface UsersListResponse {
  users: ManagedUserResponse[]
}

export interface CreateUserRequest {
  username: string
  email?: string
  role: 'admin' | 'manager' | 'operator' | 'viewer'
  initialPassword: string
}

export interface UpdateUserRequest {
  role?: 'admin' | 'manager' | 'operator' | 'viewer'
  status?: 'active' | 'inactive'
}

export interface ResetUserPasswordRequest {
  password: string
}

export interface RevokeUserSessionsResponse {
  success: true
}
