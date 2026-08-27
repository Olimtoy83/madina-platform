import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  hashPassword,
  hashSessionSecret,
  type AuthSession,
  type User,
} from '@madina/auth'
import { SqliteAuthRepository } from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

const password = 'correct horse battery staple'

function createUser(overrides: Partial<User> = {}): User {
  const now = new Date()

  return {
    id: 'user-1',
    username: 'madina.admin',
    normalizedUsername: 'madina.admin',
    role: 'admin',
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seedUser(
  repository: SqliteAuthRepository,
  user = createUser(),
): Promise<void> {
  await repository.createUser(user)
  await repository.saveCredential({
    userId: user.id,
    ...await hashPassword(password),
    passwordChangedAt: new Date(),
  })
}

async function withApp(
  seed: (repository: SqliteAuthRepository) => Promise<void>,
  run: (app: FastifyInstance, databaseFile: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-auth-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  const repository = new SqliteAuthRepository(databaseFile)

  try {
    await seed(repository)
  } finally {
    repository.close()
  }

  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()

  try {
    await app.ready()
    await run(app, databaseFile)
  } finally {
    await app.close()

    if (previousDatabaseFile === undefined) {
      delete process.env.DATABASE_FILE
    } else {
      process.env.DATABASE_FILE = previousDatabaseFile
    }

    rmSync(directory, { recursive: true, force: true })
  }
}

function getSetCookie(response: {
  headers: { ['set-cookie']?: string | string[] | number }
}): string {
  const header = response.headers['set-cookie']
  const setCookie = Array.isArray(header) ? header[0] : header

  if (typeof setCookie !== 'string') {
    throw new Error('Expected a session cookie.')
  }

  return setCookie
}

function readCookie(response: {
  headers: { ['set-cookie']?: string | string[] | number }
}) {
  const setCookie = getSetCookie(response)

  const [cookie] = setCookie.split(';')
  const [name, sessionSecret] = cookie.split('=', 2)

  if (!name || !sessionSecret) {
    throw new Error('Invalid session cookie.')
  }

  return {
    cookie,
    name,
    sessionSecret,
    setCookie,
  }
}

async function login(app: FastifyInstance) {
  return loginAs(app, 'madina.admin', password)
}

async function loginAs(
  app: FastifyInstance,
  username: string,
  userPassword: string,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      username,
      password: userPassword,
    },
  })
}

function managementHeaders(cookie: string) {
  return {
    cookie,
    origin: 'http://localhost:80',
  }
}

async function createManagedUser(
  app: FastifyInstance,
  adminCookie: string,
  username: string,
  role: 'admin' | 'manager' | 'operator' | 'viewer' = 'viewer',
  initialPassword = 'managed user password',
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/users',
    headers: managementHeaders(adminCookie),
    payload: {
      username,
      email: `${username}@example.test`,
      role,
      initialPassword,
    },
  })
}

async function updateSession(
  databaseFile: string,
  sessionSecret: string,
  update: (session: AuthSession) => AuthSession,
): Promise<void> {
  const repository = new SqliteAuthRepository(databaseFile)

  try {
    const session = await repository.findSessionByTokenHash(
      hashSessionSecret(sessionSecret),
    )

    if (!session) {
      throw new Error('Expected a stored session.')
    }

    await repository.updateSession(update(session))
  } finally {
    repository.close()
  }
}

test('auth routes create an opaque session and return only safe user data', async () => {
  await withApp(seedUser, async (app, databaseFile) => {
    const response = await login(app)
    equal(response.statusCode, 200)
    deepEqual(response.json(), {
      user: {
        id: 'user-1',
        username: 'madina.admin',
        role: 'admin',
      },
    })

    const cookie = readCookie(response)
    equal(cookie.name, 'madina-session')
    equal(cookie.setCookie.includes('HttpOnly'), true)
    equal(cookie.setCookie.includes('SameSite=Lax'), true)
    equal(cookie.setCookie.includes('Path=/'), true)
    equal(cookie.setCookie.includes('Secure'), false)
    equal(JSON.stringify(response.json()).includes(password), false)

    const repository = new SqliteAuthRepository(databaseFile)
    try {
      const session = await repository.findSessionByTokenHash(
        hashSessionSecret(cookie.sessionSecret),
      )
      const credential = await repository.findCredentialByUserId('user-1')

      equal(session?.tokenHash === cookie.sessionSecret, false)
      equal(JSON.stringify(session).includes(cookie.sessionSecret), false)
      equal(JSON.stringify(credential).includes(password), false)
    } finally {
      repository.close()
    }
  })
})

test('auth routes use the production cookie name and Secure attribute', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'

  try {
    await withApp(seedUser, async (app) => {
      const response = await login(app)
      const cookie = readCookie(response)
      equal(cookie.name, '__Host-madina-session')
      equal(cookie.setCookie.includes('Secure'), true)
    })
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})

test('wrong and unknown usernames have the same external authentication failure', async () => {
  await withApp(seedUser, async (app) => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'madina.admin', password: 'wrong password' },
    })
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'missing.user', password: 'wrong password' },
    })

    equal(wrongPassword.statusCode, 401)
    equal(unknownUser.statusCode, 401)
    deepEqual(wrongPassword.json(), unknownUser.json())
  })
})

test('inactive users cannot log in', async () => {
  await withApp(
    (repository) => seedUser(repository, createUser({ status: 'inactive' })),
    async (app) => {
      const response = await login(app)
      equal(response.statusCode, 401)
      deepEqual(response.json(), {
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid username or password.',
      })
    },
  )
})

test('me returns the authenticated principal for a valid session', async () => {
  await withApp(seedUser, async (app) => {
    const cookie = readCookie(await login(app))
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookie.cookie },
    })

    equal(response.statusCode, 200)
    deepEqual(response.json(), {
      user: {
        id: 'user-1',
        username: 'madina.admin',
        role: 'admin',
      },
    })
  })
})

test('me rejects a request without a session', async () => {
  await withApp(seedUser, async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    })

    equal(response.statusCode, 401)
  })
})

test('me rejects expired sessions', async () => {
  await withApp(seedUser, async (app, databaseFile) => {
    const cookie = readCookie(await login(app))
    await updateSession(databaseFile, cookie.sessionSecret, (session) => ({
      ...session,
      expiresAt: session.createdAt,
    }))

    const response = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookie.cookie },
    })
    equal(response.statusCode, 401)
  })
})

test('me rejects revoked sessions', async () => {
  await withApp(seedUser, async (app, databaseFile) => {
    const cookie = readCookie(await login(app))
    const repository = new SqliteAuthRepository(databaseFile)
    try {
      const session = await repository.findSessionByTokenHash(
        hashSessionSecret(cookie.sessionSecret),
      )
      await repository.revokeSession(session!.id, new Date())
    } finally {
      repository.close()
    }

    const response = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookie.cookie },
    })
    equal(response.statusCode, 401)
  })
})

test('me rejects sessions after a user sessionVersion change', async () => {
  await withApp(seedUser, async (app, databaseFile) => {
    const cookie = readCookie(await login(app))
    const repository = new SqliteAuthRepository(databaseFile)
    try {
      const user = await repository.findUserById('user-1')
      await repository.updateUser({
        ...user!,
        sessionVersion: 2,
        updatedAt: new Date(),
      })
    } finally {
      repository.close()
    }

    const response = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookie.cookie },
    })
    equal(response.statusCode, 401)
  })
})

test('logout revokes the session and remains idempotent', async () => {
  await withApp(seedUser, async (app) => {
    const cookie = readCookie(await login(app))
    const firstLogout = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: cookie.cookie },
    })
    const me = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookie.cookie },
    })
    const repeatedLogout = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: cookie.cookie },
    })

    equal(firstLogout.statusCode, 200)
    deepEqual(firstLogout.json(), { success: true })
    equal(getSetCookie(firstLogout).includes('Max-Age=0'), true)
    equal(me.statusCode, 401)
    equal(repeatedLogout.statusCode, 200)
    deepEqual(repeatedLogout.json(), { success: true })
  })
})

test('admins create every role and list only safe user representations', async () => {
  await withApp(seedUser, async (app) => {
    const adminCookie = readCookie(await login(app)).cookie

    for (const role of ['viewer', 'operator', 'manager', 'admin'] as const) {
      const response = await createManagedUser(
        app,
        adminCookie,
        `managed.${role}`,
        role,
      )
      equal(response.statusCode, 201)
      equal(response.json().role, role)
      equal(response.json().status, 'active')
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/users',
      headers: { cookie: adminCookie },
    })
    equal(response.statusCode, 200)
    equal(response.json().users.length, 5)
    equal(JSON.stringify(response.json()).includes('password_hash'), false)
    equal(JSON.stringify(response.json()).includes('sessionVersion'), false)
  })
})

test('user management rejects duplicates, unauthenticated, and non-admin requests', async () => {
  await withApp(async (repository) => {
    await seedUser(repository)
    await seedUser(repository, createUser({
      id: 'viewer-1',
      username: 'viewer.user',
      normalizedUsername: 'viewer.user',
      role: 'viewer',
    }))
  }, async (app) => {
    const adminCookie = readCookie(await login(app)).cookie
    equal((await createManagedUser(app, adminCookie, 'duplicate.user')).statusCode, 201)
    equal((await createManagedUser(app, adminCookie, 'duplicate.user')).statusCode, 409)

    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/users',
    })
    equal(unauthenticated.statusCode, 401)

    const viewerCookie = readCookie(
      await loginAs(app, 'viewer.user', password),
    ).cookie
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/users',
      headers: { cookie: viewerCookie },
    })
    equal(forbidden.statusCode, 403)
  })
})

test('role changes revoke existing sessions', async () => {
  await withApp(seedUser, async (app) => {
    const adminCookie = readCookie(await login(app)).cookie
    const created = await createManagedUser(app, adminCookie, 'role.user')
    const userCookie = readCookie(
      await loginAs(app, 'role.user', 'managed user password'),
    ).cookie
    const secondUserCookie = readCookie(
      await loginAs(app, 'role.user', 'managed user password'),
    ).cookie

    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/auth/users/${created.json().id}`,
      headers: managementHeaders(adminCookie),
      payload: { role: 'operator' },
    })
    equal(changed.statusCode, 200)
    equal(changed.json().role, 'operator')

    const staleSession = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: userCookie },
    })
    equal(staleSession.statusCode, 401)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: secondUserCookie },
    })).statusCode, 401)
  })
})

test('inactive users require a new login after reactivation', async () => {
  await withApp(seedUser, async (app) => {
    const adminCookie = readCookie(await login(app)).cookie
    const created = await createManagedUser(app, adminCookie, 'inactive.user')
    const userId = created.json().id as string
    const userCookie = readCookie(
      await loginAs(app, 'inactive.user', 'managed user password'),
    ).cookie
    const secondUserCookie = readCookie(
      await loginAs(app, 'inactive.user', 'managed user password'),
    ).cookie

    const deactivated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/auth/users/${userId}`,
      headers: managementHeaders(adminCookie),
      payload: { status: 'inactive' },
    })
    equal(deactivated.statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: userCookie },
    })).statusCode, 401)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: secondUserCookie },
    })).statusCode, 401)
    equal((await loginAs(app, 'inactive.user', 'managed user password')).statusCode, 401)

    equal((await app.inject({
      method: 'PATCH',
      url: `/api/v1/auth/users/${userId}`,
      headers: managementHeaders(adminCookie),
      payload: { status: 'active' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: userCookie },
    })).statusCode, 401)
    equal((await loginAs(app, 'inactive.user', 'managed user password')).statusCode, 200)
  })
})

test('password reset and explicit session revocation invalidate all sessions', async () => {
  await withApp(seedUser, async (app) => {
    const adminCookie = readCookie(await login(app)).cookie
    const created = await createManagedUser(app, adminCookie, 'password.user')
    const userId = created.json().id as string
    const firstCookie = readCookie(
      await loginAs(app, 'password.user', 'managed user password'),
    ).cookie
    const secondCookie = readCookie(
      await loginAs(app, 'password.user', 'managed user password'),
    ).cookie

    equal((await app.inject({
      method: 'POST',
      url: `/api/v1/auth/users/${userId}/password`,
      headers: managementHeaders(adminCookie),
      payload: { password: 'replacement user password' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: firstCookie },
    })).statusCode, 401)
    equal((await loginAs(app, 'password.user', 'managed user password')).statusCode, 401)
    const replacementCookie = readCookie(
      await loginAs(app, 'password.user', 'replacement user password'),
    ).cookie

    equal((await app.inject({
      method: 'POST',
      url: `/api/v1/auth/users/${userId}/revoke-sessions`,
      headers: managementHeaders(adminCookie),
    })).statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: secondCookie },
    })).statusCode, 401)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: replacementCookie },
    })).statusCode, 401)
  })
})

test('last active admin protection and self-mutations invalidate sessions', async () => {
  await withApp(seedUser, async (app) => {
    const firstAdminCookie = readCookie(await login(app)).cookie
    equal((await app.inject({
      method: 'PATCH', url: '/api/v1/auth/users/user-1',
      headers: managementHeaders(firstAdminCookie), payload: { status: 'inactive' },
    })).statusCode, 409)
    equal((await app.inject({
      method: 'PATCH', url: '/api/v1/auth/users/user-1',
      headers: managementHeaders(firstAdminCookie), payload: { role: 'viewer' },
    })).statusCode, 409)

    const secondAdmin = await createManagedUser(
      app, firstAdminCookie, 'second.admin', 'admin',
    )
    const thirdAdmin = await createManagedUser(
      app, firstAdminCookie, 'third.admin', 'admin',
    )
    const secondCookie = readCookie(
      await loginAs(app, 'second.admin', 'managed user password'),
    ).cookie
    const thirdCookie = readCookie(
      await loginAs(app, 'third.admin', 'managed user password'),
    ).cookie

    equal((await app.inject({
      method: 'PATCH', url: '/api/v1/auth/users/user-1',
      headers: managementHeaders(firstAdminCookie), payload: { role: 'manager' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: firstAdminCookie },
    })).statusCode, 401)

    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/auth/users/${secondAdmin.json().id}`,
      headers: managementHeaders(secondCookie), payload: { status: 'inactive' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: secondCookie },
    })).statusCode, 401)

    equal((await app.inject({
      method: 'POST', url: `/api/v1/auth/users/${thirdAdmin.json().id}/password`,
      headers: managementHeaders(thirdCookie),
      payload: { password: 'third replacement password' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: thirdCookie },
    })).statusCode, 401)
  })
})
