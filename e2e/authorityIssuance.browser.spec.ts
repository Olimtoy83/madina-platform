import { expect, test, type Browser, type Page } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { withOfflineAcceptanceHarness, type OfflineAcceptanceHarness } from './offlineAcceptanceHarness'

async function prepared(browser: Browser, run: (harness: OfflineAcceptanceHarness, page: Page) => Promise<void>) {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      await context.addCookies([{ name: 'madina-session', value: harness.sessionSecret, url: harness.url, sameSite: 'Lax' }])
      const page = await context.newPage()
      await page.goto(harness.url)
      await page.evaluate(async locationId => {
        const { beginTerminalEnrollment } = await import('/src/shared/offline/terminalProvisioning.ts')
        await beginTerminalEnrollment(locationId)
      }, harness.locationId)
      await run(harness, page)
    } finally { await context.close() }
  })
}

function effects(harness: OfflineAcceptanceHarness) {
  const db = harness.database
  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count
  return {
    authorities: count('SELECT COUNT(*) AS count FROM retail_offline_authorities'),
    permits: count('SELECT COUNT(*) AS count FROM retail_offline_authority_permits'),
    receipts: count("SELECT COUNT(*) AS count FROM retail_offline_operational_command_receipts WHERE command_type='authority_issue'"),
    audits: count("SELECT COUNT(*) AS count FROM audit_events WHERE action='retail.offline_authority_issued'"),
  }
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const { getAuthorityIssuanceState } = await import('/src/shared/offline/authorityIssuance.ts')
    return getAuthorityIssuanceState()
  })
}

async function pending(harness: OfflineAcceptanceHarness, page: Page) {
  const input = { locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), permitCount: 2, productIds: [harness.productId] }
  const auth = { user: { id: harness.userId, role: 'manager' }, isLoading: false, error: null }
  const abort = (route: import('@playwright/test').Route) => route.abort('failed')
  await page.route('**/offline-authorities', abort)
  const result = await page.evaluate(async ({ input, auth }) => {
    const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
    return beginAuthorityIssuance(input, auth as never)
  }, { input, auth })
  await page.unroute('**/offline-authorities', abort)
  expect(result.state).toBe('PENDING')
  return { result, auth }
}

async function resume(page: Page, auth: unknown) {
  return page.evaluate(async auth => {
    const { resumeAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
    return resumeAuthorityIssuance(auth as never)
  }, auth)
}

function issuanceInput(harness: OfflineAcceptanceHarness) {
  return { locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), permitCount: 2, productIds: [harness.productId] }
}

function issuanceAuth(harness: OfflineAcceptanceHarness) {
  return { user: { id: harness.userId, role: 'manager' }, isLoading: false, error: null }
}

async function renew(page: Page, completedCommandId: string, input: ReturnType<typeof issuanceInput>, auth: ReturnType<typeof issuanceAuth>) {
  return page.evaluate(async ({ completedCommandId, input, auth }) => {
    const { beginRenewedAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
    return beginRenewedAuthorityIssuance(completedCommandId, input, auth as never)
  }, { completedCommandId, input, auth })
}

async function mutateIssuance(page: Page, mutate: { state?: string; deleteRecord?: boolean; deleteMarker?: boolean; authorityId?: string; checksum?: string }) {
  await page.evaluate(async mutate => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('identity', 'readwrite')
        const store = tx.objectStore('identity')
        const record = store.get('authority-issuance:current')
        const marker = store.get('current')
        record.onsuccess = () => {
          if (mutate.deleteRecord) store.delete('authority-issuance:current')
          else if (record.result) store.put({ ...record.result, ...(mutate.state ? { state: mutate.state } : {}), ...(mutate.authorityId !== undefined ? { authorityId: mutate.authorityId } : {}), ...(mutate.checksum ? { checksum: mutate.checksum } : {}) }, 'authority-issuance:current')
        }
        marker.onsuccess = () => { if (mutate.deleteMarker) { const { authorityIssuanceExpected: _expected, authorityIssuanceChecksum: _checksum, ...rest } = marker.result; store.put(rest, 'current') } }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, mutate)
}

test('read-only inspection leaves an absent offline database absent', async ({ browser }) => {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto(harness.url)
      const exists = () => page.evaluate(async () => (await indexedDB.databases()).some(item => item.name === 'madina-crm:retail-offline-terminal-identity:v1'))
      expect(await exists()).toBe(false)
      expect(await state(page)).toEqual({ state: 'NONE' })
      expect(await exists()).toBe(false)
    } finally { await context.close() }
  })
})

test('lost response after real SQLite commit replays one durable command and one business effect', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    const before = effects(harness)
    const requestBodies: unknown[] = []
    const stateAtFirstPost: unknown[] = []
    const lost = async (route: import('@playwright/test').Route) => {
      requestBodies.push(route.request().postDataJSON())
      stateAtFirstPost.push(await state(page))
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      await route.abort('failed')
    }
    await page.route('**/offline-authorities', lost)
    const input = { locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), permitCount: 2, productIds: [harness.productId] }
    const auth = { user: { id: harness.userId, role: 'manager' }, isLoading: false, error: null }
    const first = await page.evaluate(async ({ input, auth }) => {
      const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
      return beginAuthorityIssuance(input, auth as never)
    }, { input, auth })
    expect(first.state).toBe('PENDING')
    expect(await state(page)).toMatchObject({ state: 'PENDING', commandId: first.commandId })
    expect(effects(harness)).toEqual({ authorities: before.authorities + 1, permits: before.permits + 2, receipts: before.receipts + 1, audits: before.audits + 1 })
    await page.unroute('**/offline-authorities', lost)
    await page.reload()
    const replayBodies: unknown[] = []
    const replay = async (route: import('@playwright/test').Route) => { replayBodies.push(route.request().postDataJSON()); await route.continue() }
    await page.route('**/offline-authorities', replay)
    const resumed = await page.evaluate(async auth => {
      const { resumeAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
      return resumeAuthorityIssuance(auth as never)
    }, auth)
    expect(resumed).toMatchObject({ state: 'COMPLETED', commandId: first.commandId })
    expect(resumed.authorityId).toBeTruthy()
    expect(await state(page)).toEqual(resumed)
    expect(effects(harness)).toEqual({ authorities: before.authorities + 1, permits: before.permits + 2, receipts: before.receipts + 1, audits: before.audits + 1 })
    const record = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      try { return await new Promise<Record<string, unknown>>((resolve, reject) => { const request = db.transaction('identity', 'readonly').objectStore('identity').get('authority-issuance:current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
      finally { db.close() }
    })
    expect((record.command as { commandId: string }).commandId).toBe(first.commandId)
    expect(requestBodies).toHaveLength(1)
    expect(stateAtFirstPost).toEqual([expect.objectContaining({ state: 'PENDING', commandId: first.commandId })])
    expect(requestBodies[0]).toMatchObject({ commandId: first.commandId, terminalId: resumed.terminalId, userId: harness.userId, expiresAt: input.expiresAt, permitCount: 2, productIds: [harness.productId] })
    expect(replayBodies).toEqual(requestBodies)
    expect(JSON.stringify(record)).not.toMatch(/privateKey|token|cookie|signature/)
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM retail_offline_authorities WHERE id=?').get(resumed.authorityId) as { count: number }).toEqual({ count: 1 })
    expect(await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      try { return await new Promise<number>((resolve, reject) => { const request = db.transaction('offlineAuthorities', 'readonly').objectStore('offlineAuthorities').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
      finally { db.close() }
    })).toBe(0)
  })
})

test('two real tabs converge on one durable pending command', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    const second = await page.context().newPage()
    await second.goto(harness.url)
    const postedProducts: string[][] = []
    const abort = (route: import('@playwright/test').Route) => { postedProducts.push((route.request().postDataJSON() as { productIds: string[] }).productIds); return route.abort('failed') }
    await page.context().route('**/offline-authorities', abort)
    const input = { locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), permitCount: 2, productIds: ['zz-test-product', harness.productId, 'aa-test-product'] }
    const auth = { user: { id: harness.userId, role: 'manager' }, isLoading: false, error: null }
    const attempt = (target: Page) => target.evaluate(async ({ input, auth }) => {
      const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
      return beginAuthorityIssuance(input, auth as never)
    }, { input, auth })
    const [a, b] = await Promise.all([attempt(page), attempt(second)])
    expect(a.commandId).toBeTruthy()
    expect(b.commandId).toBe(a.commandId)
    expect((await state(page)).commandId).toBe(a.commandId)
    expect(effects(harness).authorities).toBe(0)
    expect(postedProducts).toEqual([[...input.productIds].sort()])
  })
})

test('actor change and denied location grant never resend a pending command', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    const { result, auth } = await pending(harness, page)
    await page.reload()
    let posts = 0
    await page.route('**/offline-authorities', route => { posts++; return route.abort('failed') })
    const changed = await resume(page, { ...auth, user: { id: 'different-manager', role: 'manager' } })
    expect(changed).toMatchObject({ state: 'REVIEW_HOLD', commandId: result.commandId })
    expect(posts).toBe(0)
    expect(effects(harness).authorities).toBe(0)
  })
  await prepared(browser, async (harness, page) => {
    const { result, auth } = await pending(harness, page)
    harness.database.prepare('UPDATE retail_user_location_grants SET revoked_at=? WHERE user_id=? AND location_id=?').run(new Date().toISOString(), harness.userId, harness.locationId)
    await page.reload()
    let posts = 0
    const abortPost = (route: import('@playwright/test').Route) => { posts++; return route.abort('failed') }
    await page.route('**/offline-authorities', abortPost)
    const denied = await resume(page, auth)
    expect(denied).toMatchObject({ state: 'ACCESS_HOLD', commandId: result.commandId })
    expect(posts).toBe(0)
    expect(effects(harness).authorities).toBe(0)
    harness.database.prepare('UPDATE retail_user_location_grants SET revoked_at=NULL WHERE user_id=? AND location_id=?').run(harness.userId, harness.locationId)
    await page.unroute('**/offline-authorities', abortPost)
    expect(await resume(page, auth)).toMatchObject({ state: 'COMPLETED', commandId: result.commandId })
    expect(effects(harness).authorities).toBe(1)
  })
})

test('revoked terminal, missing command record, and legacy v4 state fail safely', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    expect(await state(page)).toEqual({ state: 'NONE' })
    const { result, auth } = await pending(harness, page)
    await harness.offline.revokeTerminal(result.terminalId!, 'test trust loss', crypto.randomUUID(), harness.context)
    await page.reload()
    let posts = 0
    await page.route('**/offline-authorities', route => { posts++; return route.abort('failed') })
    expect(await resume(page, auth)).toMatchObject({ state: 'REVIEW_HOLD', commandId: result.commandId })
    expect(posts).toBe(0)
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('identity', 'readwrite'); tx.objectStore('identity').delete('authority-issuance:current'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) }) }
      finally { db.close() }
    })
    await expect(state(page)).rejects.toThrow('Authority issuance state is missing.')
    expect(posts).toBe(0)
  })
})

test('server key rotation and malformed success cannot complete or resend', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    const { result, auth } = await pending(harness, page)
    const publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    await harness.offline.rotateTerminalKey(result.terminalId!, 'ed25519-spki-der-base64-v1', publicKey, crypto.randomUUID(), harness.context)
    await page.reload()
    let posts = 0
    await page.route('**/offline-authorities', route => { posts++; return route.abort('failed') })
    expect(await resume(page, auth)).toMatchObject({ state: 'REVIEW_HOLD', commandId: result.commandId })
    expect(posts).toBe(0)
  })
  await prepared(browser, async (harness, page) => {
    const input = { locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), permitCount: 2, productIds: [harness.productId] }
    const auth = { user: { id: harness.userId, role: 'manager' }, isLoading: false, error: null }
    await page.route('**/offline-authorities', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ authority: { id: 'incoherent' } }) }))
    const issued = await page.evaluate(async ({ input, auth }) => {
      const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
      return beginAuthorityIssuance(input, auth as never)
    }, { input, auth })
    expect(issued.state).toBe('REVIEW_HOLD')
    expect(effects(harness).authorities).toBe(0)
    await page.reload()
    expect(await state(page)).toMatchObject({ state: 'REVIEW_HOLD', commandId: issued.commandId })
  })
})

test('verified completion renews atomically once across two tabs', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    const input = issuanceInput(harness), auth = issuanceAuth(harness)
    const completed = await page.evaluate(async ({ input, auth }) => {
      const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
      return beginAuthorityIssuance(input, auth as never)
    }, { input, auth })
    expect(completed.state).toBe('COMPLETED')
    const old = await state(page)
    await expect(renew(page, crypto.randomUUID(), issuanceInput(harness), auth)).rejects.toThrow('Verified completed authority issuance is required.')
    expect(await state(page)).toEqual(old)
    expect(await renew(page, completed.commandId!, issuanceInput(harness), { ...auth, user: { id: 'different-manager', role: 'manager' } })).toEqual({ state: 'REVIEW_HOLD' })
    expect(await state(page)).toEqual(old)
    await expect(renew(page, completed.commandId!, { ...issuanceInput(harness), locationId: 'wrong-location' }, auth)).rejects.toThrow('Authority issuance requires an enrolled terminal.')
    expect(await state(page)).toEqual(old)
    const second = await page.context().newPage()
    await second.goto(harness.url)
    const atPost: unknown[] = []
    const postBodies: Array<{ commandId: string }> = []
    await page.context().route('**/offline-authorities', async route => {
      postBodies.push(route.request().postDataJSON() as { commandId: string })
      atPost.push(await state(page))
      await route.abort('failed')
    })
    const next = issuanceInput(harness)
    const results = await Promise.allSettled([renew(page, completed.commandId!, next, auth), renew(second, completed.commandId!, next, auth)])
    const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof renew>>> | undefined
    expect(winner?.value.state).toBe('PENDING')
    expect(winner?.value.commandId).not.toBe(completed.commandId)
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(postBodies).toHaveLength(1)
    expect(postBodies[0]!.commandId).toBe(winner!.value.commandId)
    expect(atPost).toEqual([expect.objectContaining({ state: 'PENDING', commandId: winner!.value.commandId })])
    expect(await state(page)).toMatchObject({ state: 'PENDING', commandId: winner!.value.commandId })
    expect(effects(harness).authorities).toBe(1)
  })
})

test('renewal rejects NONE and every active non-completed state without POST', async ({ browser }) => {
  await prepared(browser, async (harness, page) => {
    const input = issuanceInput(harness), auth = issuanceAuth(harness)
    expect(await state(page)).toEqual({ state: 'NONE' })
    await expect(renew(page, crypto.randomUUID(), input, auth)).rejects.toThrow('Verified completed authority issuance is required.')
    expect(await state(page)).toEqual({ state: 'NONE' })
    expect(effects(harness).authorities).toBe(0)
  })
  for (const phase of ['PENDING', 'AUTH_HOLD', 'ACCESS_HOLD', 'REVIEW_HOLD'] as const) {
    await prepared(browser, async (harness, page) => {
      const { result, auth } = await pending(harness, page)
      if (phase === 'AUTH_HOLD') await resume(page, { ...auth, user: null })
      if (phase === 'ACCESS_HOLD') {
        harness.database.prepare('UPDATE retail_user_location_grants SET revoked_at=? WHERE user_id=? AND location_id=?').run(new Date().toISOString(), harness.userId, harness.locationId)
        await resume(page, auth)
      }
      if (phase === 'REVIEW_HOLD') await resume(page, { ...auth, user: { id: 'another-user', role: 'manager' } })
      expect(await state(page)).toMatchObject({ state: phase, commandId: result.commandId })
      await expect(renew(page, result.commandId!, issuanceInput(harness), auth)).rejects.toThrow('Verified completed authority issuance is required.')
      expect(await state(page)).toMatchObject({ state: phase, commandId: result.commandId })
      expect(effects(harness).authorities).toBe(0)
    })
  }
})

test('renewal rejects corrupted or asymmetric completed tombstones and invalid new input', async ({ browser }) => {
  for (const corruption of [{ checksum: '0'.repeat(64) }, { deleteRecord: true }, { deleteMarker: true }, { authorityId: '' }]) {
    await prepared(browser, async (harness, page) => {
      const input = issuanceInput(harness), auth = issuanceAuth(harness)
      const completed = await page.evaluate(async ({ input, auth }) => {
        const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
        return beginAuthorityIssuance(input, auth as never)
      }, { input, auth })
      expect(completed.state).toBe('COMPLETED')
      await mutateIssuance(page, corruption)
      await expect(renew(page, completed.commandId!, issuanceInput(harness), auth)).rejects.toThrow()
      expect(effects(harness).authorities).toBe(1)
    })
  }
  await prepared(browser, async (harness, page) => {
    const input = issuanceInput(harness), auth = issuanceAuth(harness)
    const completed = await page.evaluate(async ({ input, auth }) => {
      const { beginAuthorityIssuance } = await import('/src/shared/offline/authorityIssuance.ts')
      return beginAuthorityIssuance(input, auth as never)
    }, { input, auth })
    const old = await state(page)
    await expect(renew(page, completed.commandId!, { ...input, permitCount: 0 }, auth)).rejects.toThrow('Authority issuance input is invalid.')
    expect(await state(page)).toEqual(old)
    expect(effects(harness).authorities).toBe(1)
  })
})
