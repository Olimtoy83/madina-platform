import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  HttpError,
  requestJson,
  subscribeToUnauthorized,
} from '../api/httpClient'
import {
  AuthSession,
  type AuthApi,
} from './AuthSession'

const user = {
  id: 'user-1',
  username: 'madina.admin',
  role: 'admin' as const,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function createApi(
  overrides: Partial<AuthApi> = {},
): AuthApi {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(user),
    login: vi.fn().mockResolvedValue(user),
    logout: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  }
}

describe('AuthSession', () => {
  it('loads an authenticated principal from /auth/me', async () => {
    const session = new AuthSession(createApi())

    await session.refresh()

    expect(session.getState()).toEqual({
      user,
      isLoading: false,
      error: null,
    })
  })

  it('treats a 401 session check as unauthenticated', async () => {
    const session = new AuthSession(createApi({
      getCurrentUser: vi.fn().mockRejectedValue(
        new HttpError(401, 'Authentication required.'),
      ),
    }))

    await session.refresh()

    expect(session.getState()).toEqual({
      user: null,
      isLoading: false,
      error: null,
    })
  })

  it('sets a principal after login and stays unauthenticated after failed login', async () => {
    const session = new AuthSession(createApi())

    await expect(session.login('madina.admin', 'correct password')).resolves.toBe(true)
    expect(session.getState().user).toEqual(user)

    const failedSession = new AuthSession(createApi({
      login: vi.fn().mockRejectedValue(new HttpError(401, 'Invalid username or password.')),
    }))

    await expect(failedSession.login('madina.admin', 'wrong password')).resolves.toBe(false)
    expect(failedSession.getState()).toMatchObject({
      user: null,
      isLoading: false,
      error: {
        message: 'Неверное имя пользователя или пароль.',
      },
    })
  })

  it('clears client auth state on logout and unauthorized invalidation', async () => {
    const session = new AuthSession(createApi())
    await session.refresh()

    await session.logout()
    expect(session.getState().user).toBeNull()

    await session.refresh()
    session.invalidate()
    expect(session.getState()).toEqual({
      user: null,
      isLoading: false,
      error: null,
    })
  })

  it('invalidates authenticated state for a domain 401 but not a 403', async () => {
    const session = new AuthSession(createApi())
    const unsubscribe = subscribeToUnauthorized(() => session.invalidate())
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ message: 'Permission denied.' }),
        { status: 403 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ message: 'Authentication required.' }),
        { status: 401 },
      ))

    vi.stubGlobal('fetch', fetchMock)
    await session.refresh()

    await expect(requestJson('/api/v1/commerce/products')).rejects.toMatchObject({
      status: 403,
    })
    expect(session.getState().user).toEqual(user)

    await expect(requestJson('/api/v1/commerce/products')).rejects.toMatchObject({
      status: 401,
    })
    expect(session.getState().user).toBeNull()

    unsubscribe()
  })
})
