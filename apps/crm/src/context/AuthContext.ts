import { createContext } from 'react'
import type { AuthUserResponse } from '@madina/api'

export interface AuthContextValue {
  user: AuthUserResponse | null
  isLoading: boolean
  isAuthenticated: boolean
  error: Error | null
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
