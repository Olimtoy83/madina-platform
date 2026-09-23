import { expect, test, type Page } from '@playwright/test'
import { verifyRetailOfflineEnvelope } from '../packages/database/src/retail/retailOfflineEnvelopeCrypto.ts'

const dbName = 'madina-crm:retail-offline-terminal-identity:v1'
const envelope = { schemaVersion: 1, offlineOperationId: 'migration-proof', authorityId: 'authority-1', authorityVersion: 1, permitId: 'permit-1', permitSequence: 0, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', proposedSaleId: 'sale-1', lines: [{ id: 'line-1', productId: 'product-1', quantity: 1, unitPriceMinor: 100 }], currencyCode: 'USD', currencyExponent: 2, cashAllocation: { id: 'payment-1', method: 'cash', amountMinor: 100, ordinal: 0 }, subtotalMinor: 100, payableTotalMinor: 100, claimedOfflineCompletedAt: '2026-09-22T00:00:00.000Z' } as const

async function reset(page: Page) {
  await page.goto('/')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName)
}
async function enroll(page: Page): Promise<string> {
  return page.evaluate(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    const value = await import('/src/shared/offline/terminalProvisioning.ts').then(m => m.beginTerminalEnrollment('location-1'))
    return value.terminalId!
  })
}
function fixture(count = 3) {
  const permits = Array.from({ length: count }, (_, sequence) => ({ permitId: `permit-${sequence}`, sequence, status: 'AVAILABLE' }))
  return { authority: { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: count, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }], permits, permitCounts: { available: count, conflictPending: 0, accepted: 0 } }, permits }
}
async function mockAuthority(page: Page, data: ReturnType<typeof fixture>, userId = 'user-1', terminalVersion = 1, role: 'manager' | 'operator' = 'manager') {
  await page.evaluate(({ data, userId, terminalVersion, role }) => {
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: userId, username: userId, role } }), { headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/offline-terminals/')) return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: terminalVersion, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
      if (path.endsWith('/permits')) return new Response(JSON.stringify({ permits: data.permits }), { headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ authority: data.authority }), { headers: { 'Content-Type': 'application/json' } })
    }
  }, { data, userId, terminalVersion, role })
}
async function mountReservation(page: Page) {
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDom } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { AuthProvider } = await import('/src/context/AuthProvider.tsx')
    const { useAuth } = await import('/src/context/useAuth.ts')
    const { useReserveOfflinePermit } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    function Probe() {
      const reserve = useReserveOfflinePermit()
      const auth = useAuth()
      ;(globalThis as any).__reservePermit = reserve
      ;(globalThis as any).__authUser = auth.user?.id
      ;(globalThis as any).__logout = auth.logout
      return null
    }
    const node = document.createElement('div')
    document.body.append(node)
    ReactDom.createRoot(node).render(React.createElement(AuthProvider, null, React.createElement(Probe)))
    await new Promise<void>((resolve, reject) => { let attempts = 0; const tick = () => { if ((globalThis as any).__authUser) resolve(); else if (++attempts > 100) reject(new Error('AuthSession did not load.')); else setTimeout(tick, 10) }; tick() })
  })
}

test('v1 identity upgrades to v2 without losing the non-extractable signing key', async ({ page }) => {
  await reset(page)
  const before = await page.evaluate(async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))))
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('identity'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('identity', 'readwrite'); tx.objectStore('identity').put({ version: 1, publicKeyAlgorithm: 'ed25519-spki-der-base64-v1', publicKey, privateKey: pair.privateKey, terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1 }, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
    return publicKey
  })
  const after = await page.evaluate(async input => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    const loaded = await identity.loadTerminalIdentity()
    if (!loaded) throw new Error('migration lost identity')
    const signed = await loaded.signOfflineEnvelope(input)
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const raw = await new Promise<any>((resolve, reject) => { const r = db.transaction('identity', 'readonly').objectStore('identity').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const stores = Array.from(db.objectStoreNames)
    db.close()
    return { publicKey: loaded.publicKey, terminalId: loaded.terminalId, keyVersion: loaded.currentKeyVersion, extractable: raw.privateKey.extractable, stores, signed }
  }, envelope)
  expect(after).toMatchObject({ publicKey: before, terminalId: 'terminal-1', keyVersion: 1, extractable: false })
  expect(after.stores).toEqual(expect.arrayContaining(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta']))
  expect(verifyRetailOfflineEnvelope({ envelope, payloadHash: after.signed.payloadHash, signature: after.signed.signature, keyAlgorithm: 'ed25519-spki-der-base64-v1', publicKey: before }).payloadHash).toBe(after.signed.payloadHash)
})

test('v1 pending enrollment survives v2 upgrade with its exact command and SPKI', async ({ page }) => {
  await reset(page)
  const original = await page.evaluate(async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))))
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('identity'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('identity', 'readwrite'); tx.objectStore('identity').put({ version: 1, publicKeyAlgorithm: 'ed25519-spki-der-base64-v1', publicKey, privateKey: pair.privateKey, pending: { kind: 'enrollment', commandId: 'pending-before-upgrade', locationId: 'location-1', publicKey } }, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
    return publicKey
  })
  const recovered = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    const pending = await identity.loadPendingTerminalOperation()
    let sent: unknown
    globalThis.fetch = async (_url, init) => { sent = JSON.parse(String(init?.body)); throw new TypeError('response lost') }
    await import('/src/shared/offline/terminalProvisioning.ts').then(m => m.beginTerminalEnrollment('location-1')).catch(() => undefined)
    return { pending, sent }
  })
  expect(recovered.pending).toMatchObject({ kind: 'enrollment', commandId: 'pending-before-upgrade', locationId: 'location-1', publicKey: original })
  expect(recovered.sent).toMatchObject({ commandId: 'pending-before-upgrade', publicKey: original })
})

test('Authority installation validates immutable snapshot, complete permits, reload and storage loss', async ({ page }) => {
  await reset(page)
  await enroll(page)
  const valid = fixture(2)
  const invalid = [
    { ...valid, authority: { ...valid.authority, terminalId: 'foreign' } },
    { ...valid, authority: { ...valid.authority, locationId: 'foreign' } },
    { ...valid, authority: { ...valid.authority, currencyCode: 'bad' } },
    { ...valid, permits: valid.permits.slice(0, 1) },
    { ...valid, permits: [{ ...valid.permits[0] }, { ...valid.permits[0] }] },
    { ...valid, permits: [{ ...valid.permits[0], permitId: 'foreign' }, valid.permits[1]] },
  ]
  for (const item of invalid) {
    await mockAuthority(page, item)
    const rejected = await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')).then(() => false, () => true))
    expect(rejected).toBe(true)
  }
  await mockAuthority(page, valid)
  const installed = await page.evaluate(async () => {
    const ledger = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    const value = await ledger.installOfflineAuthority('location-1', 'authority-1', 'user-1')
    const repeated = await ledger.installOfflineAuthority('location-1', 'authority-1', 'user-1')
    const price = await ledger.getAuthorizedProduct('location-1', 'authority-1', 'product-1')
    return { value, repeated, price }
  })
  expect(installed.repeated).toEqual(installed.value)
  expect(installed.price).toEqual({ productId: 'product-1', unitPriceMinor: 100 })
  await page.reload()
  const persisted = await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.loadOfflineAuthority('location-1', 'authority-1')))
  expect(persisted).toEqual(installed.value)
  await mockAuthority(page, valid)
  await mountReservation(page)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'unsynced-operation'))).toMatchObject({ permitId: 'permit-0', sequence: 0 })
  await mockAuthority(page, { ...valid, authority: { ...valid.authority, productPrices: [{ productId: 'product-1', unitPriceMinor: 101 }] } })
  expect(await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')).then(() => false, () => true))).toBe(true)
  await mockAuthority(page, valid)
  const lost = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('offlinePermits', 'readwrite'); tx.objectStore('offlinePermits').delete(['authority-1', 0]); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
    const ledger = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    const reinstallBlocked = await ledger.installOfflineAuthority('location-1', 'authority-1', 'user-1').then(() => false, () => true)
    const readBlocked = await ledger.loadOfflineAuthority('location-1', 'authority-1').then(() => false, () => true)
    const reserveBlocked = await (globalThis as any).__reservePermit('location-1', 'authority-1', 'another-operation').then(() => false, () => true)
    return { reinstallBlocked, readBlocked, reserveBlocked }
  })
  expect(lost).toEqual({ reinstallBlocked: true, readBlocked: true, reserveBlocked: true })
})

test('server-consumed permits are not reservable on install or refresh', async ({ page }) => {
  await reset(page)
  await enroll(page)
  const valid = fixture(2)
  const consumed = {
    authority: { ...valid.authority, permits: [{ ...valid.permits[0]!, status: 'CONSUMED_ACCEPTED' }, { ...valid.permits[1]!, status: 'CONSUMED_CONFLICT_PENDING' }], permitCounts: { available: 0, conflictPending: 1, accepted: 1 } },
    permits: [{ ...valid.permits[0]!, status: 'CONSUMED_ACCEPTED' }, { ...valid.permits[1]!, status: 'CONSUMED_CONFLICT_PENDING' }],
  }
  await mockAuthority(page, consumed)
  expect(await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1').then(() => false, () => true)))).toBe(true)
  await mockAuthority(page, valid)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  await mockAuthority(page, consumed)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  await mockAuthority(page, valid)
  await mountReservation(page)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'consumed-op').then(() => false, () => true))).toBe(true)
  const persisted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction('offlinePermits', 'readonly')
    const read = (sequence: number) => new Promise<any>((resolve, reject) => { const r = tx.objectStore('offlinePermits').get(['authority-1', sequence]); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const result = await Promise.all([read(0), read(1)])
    db.close()
    return result.map(p => ({ serverStatus: p.serverStatus, localState: p.localState, operationId: p.operationId }))
  })
  expect(persisted).toEqual([{ serverStatus: 'CONSUMED_ACCEPTED', localState: 'AVAILABLE', operationId: undefined }, { serverStatus: 'CONSUMED_CONFLICT_PENDING', localState: 'AVAILABLE', operationId: undefined }])
})

test('multiple Authorities require explicit selection and bind operationId globally', async ({ page }) => {
  await reset(page)
  await enroll(page)
  const first = fixture(1)
  const secondBase = fixture(1)
  const second = { authority: { ...secondBase.authority, authorityId: 'authority-2', permits: [{ ...secondBase.permits[0]!, permitId: 'permit-second' }] }, permits: [{ ...secondBase.permits[0]!, permitId: 'permit-second' }] }
  await mockAuthority(page, first)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  await mockAuthority(page, second)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-2', 'user-1')))
  await mockAuthority(page, first)
  await mountReservation(page)
  const reserved = await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'one-operation'))
  expect(reserved).toMatchObject({ authorityId: 'authority-1', permitId: 'permit-0' })
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-2', 'one-operation').then(() => false, () => true))).toBe(true)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', '', 'another-operation').then(() => false, () => true))).toBe(true)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-2', 'another-operation'))).toMatchObject({ authorityId: 'authority-2', permitId: 'permit-second' })
})

test('real AuthSession and two Chrome contexts reserve deterministically without double allocation', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage()
    await reset(a)
    await enroll(a)
    const valid = fixture(2)
    await mockAuthority(a, valid)
    await a.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
    await mockAuthority(a, valid, 'user-1', 1, 'operator')
    await mountReservation(a)
    const b = await context.newPage()
    await b.goto('/')
    await mockAuthority(b, valid, 'user-1', 1, 'operator')
    await mountReservation(b)
    const [first, second] = await Promise.all([a.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'op-a')), b.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'op-b'))])
    expect([first.sequence, second.sequence].sort()).toEqual([0, 1])
    expect(first.permitId).not.toBe(second.permitId)
    const replay = await a.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'op-a'))
    expect(replay).toEqual(first)
    expect(await b.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'op-c').then(() => false, () => true))).toBe(true)
    await a.reload()
    await mockAuthority(a, valid, 'user-1', 1, 'operator')
    await mountReservation(a)
    expect(await a.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'op-a'))).toEqual(first)
    await a.evaluate(() => (globalThis as any).__logout())
    expect(await a.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'op-new').then(() => false, () => true))).toBe(true)
  } finally { await context.close() }
})

test('pending rotation committed between preflight and reservation transaction blocks new allocation but preserves retry', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage()
    await reset(a)
    await enroll(a)
    const valid = fixture(2)
    await mockAuthority(a, valid)
    await a.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
    await mockAuthority(a, valid, 'user-1', 1, 'operator')
    await mountReservation(a)
    const committed = await a.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'committed-op'))

    const b = await context.newPage()
    await b.goto('/')
    await a.evaluate(() => {
      const original = indexedDB.open.bind(indexedDB)
      let opens = 0
      let release!: () => void
      ;(globalThis as any).__releaseReservationOpen = () => release()
      const gate = new Promise<void>(resolve => { release = resolve })
      indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
        const request = original(...args)
        if (++opens !== 3) return request
        return new Proxy(request, {
          get(target, property) { return Reflect.get(target, property, target) },
          set(target, property, value) {
            if (property === 'onsuccess') {
              target.onsuccess = event => {
                ;(globalThis as any).__reservationPreflightPassed = true
                void gate.then(() => value.call(target, event))
              }
              return true
            }
            return Reflect.set(target, property, value, target)
          },
        })
      }) as IDBFactory['open']
      ;(globalThis as any).__racingReservation = (globalThis as any).__reservePermit('location-1', 'authority-1', 'racing-op').then(() => 'ALLOCATED', (error: Error) => error.message)
    })
    await a.waitForFunction(() => (globalThis as any).__reservationPreflightPassed === true)
    const pending = await b.evaluate(async () => import('/src/shared/offline/terminalIdentity.ts').then(m => m.prepareTerminalRotation('race-rotation')))
    expect(pending).toMatchObject({ kind: 'rotation', commandId: 'race-rotation' })
    await a.evaluate(() => (globalThis as any).__releaseReservationOpen())
    expect(await a.evaluate(() => (globalThis as any).__racingReservation)).toBe('Terminal provisioning is pending.')
    expect(await a.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'committed-op'))).toEqual(committed)

    const durable = await b.evaluate(async () => {
      const validatedPending = await import('/src/shared/offline/terminalIdentity.ts').then(m => m.loadPendingTerminalOperation())
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const tx = db.transaction(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta'], 'readonly')
      const read = (store: string, key: IDBValidKey) => new Promise<any>((resolve, reject) => { const r = tx.objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const [identity, authority, first, second, meta] = await Promise.all([read('identity', 'current'), read('offlineAuthorities', 'authority-1'), read('offlinePermits', ['authority-1', 0]), read('offlinePermits', ['authority-1', 1]), read('offlineMeta', 'state')])
      db.close()
      return { pending: identity.pending?.commandId, validatedPending: validatedPending?.commandId, marker: identity.offlineStateEverInstalled, authorityId: authority.snapshot.authorityId, first: { state: first.localState, operationId: first.operationId }, second: { state: second.localState, operationId: second.operationId }, authorityIds: meta.authorityIds }
    })
    expect(durable).toEqual({ pending: 'race-rotation', validatedPending: 'race-rotation', marker: true, authorityId: 'authority-1', first: { state: 'RESERVED', operationId: 'committed-op' }, second: { state: 'AVAILABLE', operationId: undefined }, authorityIds: ['authority-1'] })
  } finally { await context.close() }
})

test('user, time, revocation, rotation and identity loss gate new reservations without releasing prior ones', async ({ page }) => {
  await reset(page)
  await enroll(page)
  const valid = fixture(2)
  await mockAuthority(page, valid, 'user-2')
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  await mountReservation(page)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'wrong-user-op').then(() => false, () => true))).toBe(true)

  await page.reload()
  await mockAuthority(page, valid)
  await mountReservation(page)
  const expired = await page.evaluate(async expiresAt => {
    const now = Date.now
    Date.now = () => new Date(expiresAt).getTime()
    try { return await (globalThis as any).__reservePermit('location-1', 'authority-1', 'expired-op').then(() => false, () => true) }
    finally { Date.now = now }
  }, valid.authority.expiresAt)
  expect(expired).toBe(true)
  const reserved = await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'original-op'))
  expect(reserved.sequence).toBe(0)
  const rollback = await page.evaluate(async issuedAt => {
    const now = Date.now
    Date.now = () => new Date(issuedAt).getTime()
    try { return await (globalThis as any).__reservePermit('location-1', 'authority-1', 'rollback-op').then(() => false, () => true) }
    finally { Date.now = now }
  }, valid.authority.issuedAt)
  expect(rollback).toBe(true)

  const rotated = await page.evaluate(async () => {
    globalThis.fetch = async (url, init) => new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: init?.method === 'POST' ? 2 : 1, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
    const value = await import('/src/shared/offline/terminalProvisioning.ts').then(m => m.beginTerminalKeyRotation('location-1'))
    const ledger = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    const cached = await ledger.loadOfflineAuthority('location-1', 'authority-1')
    const prior = await (globalThis as any).__reservePermit('location-1', 'authority-1', 'original-op')
    const newBlocked = await (globalThis as any).__reservePermit('location-1', 'authority-1', 'new-after-rotation').then(() => false, () => true)
    return { keyVersion: value.currentKeyVersion, cachedVersion: cached?.terminalKeyVersion, prior, newBlocked }
  })
  expect(rotated).toEqual({ keyVersion: 2, cachedVersion: 1, prior: reserved, newBlocked: true })

  const revoked = { ...valid, authority: { ...valid.authority, revoked: true, revocation: { revokedAt: new Date().toISOString(), revokedByUserId: 'manager-1', reason: 'lost trust' } } }
  await mockAuthority(page, revoked, 'user-1', 2)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  await mockAuthority(page, valid, 'user-1', 2)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'new-after-revocation').then(() => false, () => true))).toBe(true)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'original-op'))).toEqual(reserved)
  await page.evaluate(async () => import('/src/shared/offline/terminalIdentity.ts').then(m => m.clearTerminalIdentity()))
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'new-after-identity-loss').then(() => false, () => true))).toBe(true)
})

test('confirmed terminal revocation durably disables new local permit reservation', async ({ page }) => {
  await reset(page)
  await enroll(page)
  const valid = fixture(1)
  await mockAuthority(page, valid)
  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')))
  await mountReservation(page)
  await page.evaluate(data => {
    globalThis.fetch = async url => String(url).includes('/offline-terminals/')
      ? new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: true } }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(String(url).endsWith('/permits') ? { permits: data.permits } : { authority: data.authority }), { headers: { 'Content-Type': 'application/json' } })
  }, valid)
  expect(await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1')).then(() => false, () => true))).toBe(true)
  await mockAuthority(page, valid)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'post-revocation').then(() => false, () => true))).toBe(true)
  await page.reload()
  await mockAuthority(page, valid)
  await mountReservation(page)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'post-reload').then(() => false, () => true))).toBe(true)
})
