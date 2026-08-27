import type { AuthUserResponse } from '@madina/api'
import { HttpError } from '../api/httpClient'

export interface AuthApi {
  getCurrentUser(): Promise<AuthUserResponse>
  login(input: {
    username: string
    password: string
  }): Promise<AuthUserResponse>
  logout(): Promise<unknown>
}

export interface AuthSessionState {
  user: AuthUserResponse | null
  isLoading: boolean
  error: Error | null
}

type AuthSessionListener = (state: AuthSessionState) => void

function toError(
  fallbackMessage: string,
): Error {
  return new Error(fallbackMessage)
}

export class AuthSession {
  private state: AuthSessionState = {
    user: null,
    isLoading: true,
    error: null,
  }

  private readonly listeners = new Set<AuthSessionListener>()

  private readonly api: AuthApi

  constructor(api: AuthApi) {
    this.api = api
  }

  getState(): AuthSessionState {
    return this.state
  }

  subscribe(listener: AuthSessionListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async refresh(): Promise<void> {
    this.setState({
      user: null,
      isLoading: true,
      error: null,
    })

    try {
      const user = await this.api.getCurrentUser()
      this.setState({
        user,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      this.setState({
        user: null,
        isLoading: false,
        error: error instanceof HttpError && error.status === 401
          ? null
          : toError('Не удалось проверить сессию.'),
      })
    }
  }

  async login(
    username: string,
    password: string,
  ): Promise<boolean> {
    this.setState({
      user: null,
      isLoading: true,
      error: null,
    })

    try {
      const user = await this.api.login({
        username,
        password,
      })
      this.setState({
        user,
        isLoading: false,
        error: null,
      })
      return true
    } catch (error) {
      this.setState({
        user: null,
        isLoading: false,
        error: toError('Неверное имя пользователя или пароль.'),
      })
      return false
    }
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout()
    } catch {
      // Clear the client boundary even if the server is unavailable.
    } finally {
      this.invalidate()
    }
  }

  invalidate(): void {
    this.setState({
      user: null,
      isLoading: false,
      error: null,
    })
  }

  private setState(state: AuthSessionState): void {
    this.state = state

    for (const listener of this.listeners) {
      listener(state)
    }
  }
}
