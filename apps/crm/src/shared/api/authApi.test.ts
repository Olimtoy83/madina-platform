import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  getCurrentUser,
  login,
  logout,
} from './authApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

function installFetch(body: unknown) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
    new Response(
      JSON.stringify(body),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  ))

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('authApi', () => {
  it('uses the shared auth endpoints without exposing a session secret', async () => {
    const fetchMock = installFetch({
      user: {
        id: 'user-1',
        username: 'madina.admin',
        role: 'admin',
      },
    })

    await login({
      username: 'madina.admin',
      password: 'correct password',
    })
    await getCurrentUser()
    await logout()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
    ])
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('sessionSecret')
  })
})
