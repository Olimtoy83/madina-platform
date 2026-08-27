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
