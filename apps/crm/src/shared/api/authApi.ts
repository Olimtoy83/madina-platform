import type {
  AuthUserResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
} from '@madina/api'
import { requestJson } from './httpClient'

const authUrl = '/api/v1/auth'

export async function login(
  input: LoginRequest,
): Promise<AuthUserResponse> {
  const response = await requestJson<LoginResponse>(
    `${authUrl}/login`,
    {
      method: 'POST',
      body: input,
    },
  )

  return response.user
}

export async function getCurrentUser(): Promise<AuthUserResponse> {
  const response = await requestJson<MeResponse>(
    `${authUrl}/me`,
  )

  return response.user
}

export function logout(): Promise<LogoutResponse> {
  return requestJson<LogoutResponse>(
    `${authUrl}/logout`,
    {
      method: 'POST',
    },
  )
}
