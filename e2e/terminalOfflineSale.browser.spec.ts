import { expect, test, type Page } from '@playwright/test'
import { verifyRetailOfflineEnvelope } from '../packages/database/src/retail/retailOfflineEnvelopeCrypto.ts'

const dbName = 'madina-crm:retail-offline-terminal-identity:v1'
type Fixture = ReturnType<typeof fixture>
function fixture(count = 2): { authority: Record<string, unknown>; permits: Array<{ permitId: string; sequence: number; status: string }> } {
  const permits = Array.from({ length: count }, (_, sequence) => ({ permitId: `permit-${sequence}`, sequence, status: 'AVAILABLE' }))
  return { authority: { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: count, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 125 }, { productId: 'product-2', unitPriceMinor: 75 }], permits, permitCounts: { available: count, conflictPending: 0, accepted: 0 } }, permits }
}
async function reset(page: Page) {
  await page.goto('/')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName)
}
async function mock(page: Page, data: Fixture, userId = 'user-1', terminalRevoked = false) {
  await page.evaluate(({ data, userId, terminalRevoked }) => {
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: userId, username: userId, role: 'manager' } }), { headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/offline-terminals')) return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: terminalRevoked } }), { headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify(path.endsWith('/permits') ? { permits: data.permits } : { authority: data.authority }), { headers: { 'Content-Type': 'application/json' } })
    }
  }, { data, userId, terminalRevoked })
}
async function setup(page: Page, count = 2) {
  await reset(page)
  const data = fixture(count)
  await mock(page, data)
  const publicKey = await page.evaluate(async () => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    const identity = await service.beginTerminalEnrollment('location-1')
    await import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1'))
    return identity.publicKey
  })
  await mount(page)
  return { data, publicKey }
}
async function mount(page: Page) {
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDom } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { AuthProvider } = await import('/src/context/AuthProvider.tsx')
    const { useAuth } = await import('/src/context/useAuth.ts')
    const { useCommitOfflineSale } = await import('/src/shared/offline/offlineLocalSale.ts')
    const { useReserveOfflinePermit } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    function Probe() {
      const commit = useCommitOfflineSale()
      const reserve = useReserveOfflinePermit()
      const auth = useAuth()
      ;(globalThis as any).__commitSale = commit
      ;(globalThis as any).__reservePermit = reserve
      ;(globalThis as any).__authUser = auth.user?.id
      ;(globalThis as any).__logout = auth.logout
      ;(globalThis as any).__refresh = auth.refresh
      return null
    }
    const node = document.createElement('div')
    document.body.append(node)
    ReactDom.createRoot(node).render(React.createElement(AuthProvider, null, React.createElement(Probe)))
    await new Promise<void>((resolve, reject) => { let n = 0; const tick = () => { if ((globalThis as any).__authUser) resolve(); else if (++n > 100) reject(new Error('AuthSession unavailable')); else setTimeout(tick, 10) }; tick() })
  })
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction(['identity', 'offlineAuthorities', 'offlineMeta', 'offlinePermits', 'offlineSales'], 'readonly')
    const all = (store: string) => new Promise<any[]>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const [identities, authorities, meta, permits, sales] = await Promise.all([all('identity'), all('offlineAuthorities'), all('offlineMeta'), all('offlinePermits'), all('offlineSales')])
    db.close()
    return { identity: { publicKey: identities[0]?.publicKey, offlineSaleEverPrepared: identities[0]?.offlineSaleEverPrepared }, authorities, meta: meta[0], permits, sales }
  })
}
const intent = (operationId: string, quantity = 2) => ({ authorityId: 'authority-1', operationId, lines: [{ productId: 'product-1', quantity }] })

test('cash Sale uses Authority price, persists exact evidence, and passes server verifier after reload', async ({ page }) => {
  await setup(page)
  const prior = await read(page)
  const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('sale-op-1'))
  const after = await read(page)
  expect(after.identity.publicKey).toBe(prior.identity.publicKey)
  expect(after.identity.offlineSaleEverPrepared).toBe(true)
  expect(after.meta.saleOperationIds).toEqual(['sale-op-1'])
  expect(committed.state).toBe('COMMITTED_LOCAL')
  expect(committed.envelope).toMatchObject({ offlineOperationId: 'sale-op-1', proposedSaleId: 'sale-op-1', authorityId: 'authority-1', permitId: 'permit-0', permitSequence: 0, subtotalMinor: 250, payableTotalMinor: 250, currencyCode: 'USD', currencyExponent: 2, cashAllocation: { method: 'cash', ordinal: 0, amountMinor: 250 }, lines: [{ productId: 'product-1', quantity: 2, unitPriceMinor: 125 }] })
  expect(after.sales).toEqual([committed])
  expect(after.permits[0]).toMatchObject({ localState: 'CONSUMED_LOCAL', operationId: 'sale-op-1', saleId: 'sale-op-1' })
  expect(verifyRetailOfflineEnvelope({ envelope: committed.envelope, payloadHash: committed.payloadHash, signature: committed.signature, keyAlgorithm: 'ed25519-spki-der-base64-v1', publicKey: prior.identity.publicKey }).canonicalPayload).toBe(committed.canonicalPayload)
  const again = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('sale-op-1'))
  expect(again).toEqual(committed)
  expect(await page.evaluate(() => (globalThis as any).__reservePermit('location-1', 'authority-1', 'sale-op-1').then(() => 'RESERVED', (error: Error) => error.message))).not.toBe('RESERVED')
  expect(await read(page)).toEqual(after)
  const derived = await page.evaluate(input => (globalThis as any).__commitSale(input), { authorityId: 'authority-1', operationId: 'sale-op-2', lines: [{ productId: 'product-2', quantity: 1, unitPriceMinor: 1 }, { productId: 'product-1', quantity: 2, unitPriceMinor: 1 } ] })
  expect(derived.envelope.lines.map((line: any) => [line.productId, line.unitPriceMinor])).toEqual([['product-1', 125], ['product-2', 75]])
  expect(derived.envelope).toMatchObject({ subtotalMinor: 325, payableTotalMinor: 325, cashAllocation: { amountMinor: 325 } })
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input), { authorityId: 'authority-1', operationId: 'sale-op-2', lines: [{ productId: 'product-1', quantity: 2 }, { productId: 'product-2', quantity: 1 }] })).toEqual(derived)
  const afterBoth = await read(page)
  await page.reload()
  await mock(page, fixture())
  await mount(page)
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input), intent('sale-op-1'))).toEqual(committed)
  expect(await read(page)).toEqual(afterBoth)
})

test('changed intent, invalid lines, and permit exhaustion fail closed', async ({ page }) => {
  await setup(page, 1)
  const bad = [{ ...intent('bad-1'), lines: [] }, { ...intent('bad-2'), lines: [{ productId: 'product-1', quantity: 0 }] }, { ...intent('bad-3'), lines: [{ productId: 'product-1', quantity: 1 }, { productId: 'product-1', quantity: 1 }] }, { ...intent('bad-4'), lines: [{ productId: 'unknown', quantity: 1 }] }, { ...intent('bad-5'), lines: [{ productId: 'product-1', quantity: Number.MAX_SAFE_INTEGER }] }]
  for (const input of bad) expect(await page.evaluate(value => (globalThis as any).__commitSale(value).then(() => false, () => true), input)).toBe(true)
  const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('sale-op-1'))
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => false, (e: Error) => e.message), intent('sale-op-1', 3))).toBe('IDEMPOTENCY_CONFLICT')
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => false, (e: Error) => e.message), { ...intent('sale-op-1'), authorityId: 'authority-2' })).toBe('IDEMPOTENCY_CONFLICT')
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => false, () => true), intent('sale-op-2'))).toBe(true)
  expect((await read(page)).sales).toEqual([committed])
})

test('actual v2 identity, Authority, permits and legacy RESERVED survive v4; legacy operation cannot become a Sale', async ({ page }) => {
  await reset(page)
  const data = fixture(2)
  const before = await page.evaluate(async ({ name, data }) => {
    const { revoked: _revoked, permits: _permits, permitCounts: _counts, ...snapshot } = data.authority
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))))
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, 2)
      r.onupgradeneeded = () => { for (const store of ['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta']) r.result.createObjectStore(store) }
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta'], 'readwrite')
      tx.objectStore('identity').put({ version: 1, publicKeyAlgorithm: 'ed25519-spki-der-base64-v1', privateKey: pair.privateKey, publicKey, terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, offlineStateEverInstalled: true }, 'current')
      tx.objectStore('offlineAuthorities').put({ snapshot, knownRevoked: false }, 'authority-1')
      data.permits.forEach((permit, sequence) => tx.objectStore('offlinePermits').put({ authorityId: 'authority-1', permitId: permit.permitId, sequence, serverStatus: 'AVAILABLE', localState: sequence === 0 ? 'RESERVED' : 'AVAILABLE', ...(sequence === 0 ? { operationId: 'legacy-op' } : {}) }, ['authority-1', sequence]))
      tx.objectStore('offlineMeta').put({ version: 1, terminalId: 'terminal-1', locationId: 'location-1', authorityIds: ['authority-1'], lastObservedMs: Date.now() - 1000, knownTerminalUnsafe: false }, 'state')
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
    return { publicKey, extractable: pair.privateKey.extractable }
  }, { name: dbName, data })
  await mock(page, data)
  await mount(page)
  const legacy = await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'ACCEPTED', (error: Error) => error.message), intent('legacy-op'))
  expect(legacy).toBe('LEGACY_RESERVED_WITHOUT_PREPARED')
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'ACCEPTED', (error: Error) => error.message), { ...intent('legacy-op'), authorityId: 'authority-2' })).toBe('Operation is bound to another Authority.')
  const upgraded = await read(page)
  expect(upgraded.identity.publicKey).toBe(before.publicKey)
  const upgrade = await page.evaluate(async () => {
    const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1')
    return new Promise<{ version: number; stores: string[] }>((resolve, reject) => {
      request.onsuccess = () => {
        const database = request.result
        const result = { version: database.version, stores: Array.from(database.objectStoreNames) }
        database.close()
        resolve(result)
      }
      request.onerror = () => reject(request.error)
    })
  })
  expect(upgrade).toMatchObject({ version: 4, stores: expect.arrayContaining(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales', 'offlineSaleSync']) })
  expect(before.extractable).toBe(false)
  expect(upgraded.permits[0]).toMatchObject({ localState: 'RESERVED', operationId: 'legacy-op' })
  expect(upgraded.sales).toEqual([])
  const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('fresh-op'))
  expect(committed.envelope.permitSequence).toBe(1)
  expect((await read(page)).permits[0]).toMatchObject({ localState: 'RESERVED', operationId: 'legacy-op' })
})

test('PREPARED survives signing failure and reload; exact continuation reuses envelope and permit', async ({ page }) => {
  await setup(page, 1)
  const interrupted = await page.evaluate(async input => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = function (algorithm, key, data) {
      if (new TextDecoder().decode(data).startsWith('{')) throw new Error('simulated signing crash')
      return original.call(this, algorithm, key, data)
    }
    try { return await (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message) }
    finally { SubtleCrypto.prototype.sign = original }
  }, intent('crash-op'))
  expect(interrupted).not.toBe('COMMITTED')
  const before = await read(page)
  expect(before.sales[0].state).toBe('PREPARED')
  expect(before.permits[0]).toMatchObject({ localState: 'RESERVED', operationId: 'crash-op' })
  expect(before.meta.saleOperationIds).toEqual(['crash-op'])
  await page.reload()
  await mock(page, fixture(1))
  await mount(page)
  const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('crash-op'))
  expect(committed.state).toBe('COMMITTED_LOCAL')
  expect(committed.envelope).toEqual(before.sales[0].envelope)
  expect((await read(page)).permits[0].localState).toBe('CONSUMED_LOCAL')
})

test('final transaction abort preserves PREPARED and RESERVED atomically', async ({ page }) => {
  await setup(page, 1)
  const interrupted = await page.evaluate(async input => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      if (this.name === 'offlineSales' && value?.state === 'COMMITTED_LOCAL') throw new Error('simulated final transaction abort')
      return original.call(this, value, key!)
    }
    try { return await (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message) }
    finally { IDBObjectStore.prototype.put = original }
  }, intent('abort-op'))
  expect(interrupted).not.toBe('COMMITTED')
  const before = await read(page)
  expect(before.sales[0].state).toBe('PREPARED')
  expect(before.permits[0].localState).toBe('RESERVED')
  const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('abort-op'))
  expect(committed.envelope).toEqual(before.sales[0].envelope)
  expect((await read(page)).permits[0].localState).toBe('CONSUMED_LOCAL')
})

test('format-valid wrong, wrong-payload and wrong-key signatures cannot commit or consume permit', async ({ page }) => {
  for (const mode of ['random', 'wrong-payload', 'wrong-key']) {
    await setup(page, 1)
    const rejected = await page.evaluate(async ({ input, mode }) => {
      const foreign = mode === 'wrong-key' ? await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) : undefined
      const original = SubtleCrypto.prototype.sign
      SubtleCrypto.prototype.sign = function (algorithm, key, bytes) {
        if (!new TextDecoder().decode(bytes).startsWith('{')) return original.call(this, algorithm, key, bytes)
        if (mode === 'random') return Promise.resolve(crypto.getRandomValues(new Uint8Array(64)).buffer)
        if (mode === 'wrong-payload') return original.call(this, algorithm, key, new TextEncoder().encode('different canonical payload'))
        return original.call(this, algorithm, foreign!.privateKey, bytes)
      }
      try { return await (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message) }
      finally { SubtleCrypto.prototype.sign = original }
    }, { input: intent(`invalid-${mode}`), mode })
    expect(rejected, mode).not.toBe('COMMITTED')
    const prepared = await read(page)
    expect(prepared.sales, mode).toHaveLength(1)
    expect(prepared.sales[0].state, mode).toBe('PREPARED')
    expect(prepared.permits[0], mode).toMatchObject({ localState: 'RESERVED', operationId: `invalid-${mode}` })
    expect(prepared.meta.saleOperationIds, mode).toEqual([`invalid-${mode}`])
    const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent(`invalid-${mode}`))
    expect(committed.envelope, mode).toEqual(prepared.sales[0].envelope)
    expect((await read(page)).permits[0].localState, mode).toBe('CONSUMED_LOCAL')
  }
})

test('forced PREPARE abort rolls back queued permit, Sale, identity marker and metadata writes', async ({ page }) => {
  await setup(page, 1)
  const before = await read(page)
  const rejected = await page.evaluate(async input => {
    const original = IDBObjectStore.prototype.put
    let permitQueued = false, saleQueued = false, identityQueued = false
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      if (this.name === 'offlinePermits' && value?.operationId === input.operationId) permitQueued = true
      if (this.name === 'offlineSales' && value?.state === 'PREPARED') saleQueued = true
      if (this.name === 'identity' && value?.offlineSaleEverPrepared === true) identityQueued = true
      if (this.name === 'offlineMeta' && value?.saleOperationIds?.includes(input.operationId)) throw new Error('forced late PREPARE abort')
      return original.call(this, value, key!)
    }
    try {
      const result = await (globalThis as any).__commitSale(input).then(() => 'PREPARED', (error: Error) => error.message)
      return { result, permitQueued, saleQueued, identityQueued }
    } finally { IDBObjectStore.prototype.put = original }
  }, intent('prepare-abort-op'))
  expect(rejected).toMatchObject({ result: 'Offline storage transaction failed.', permitQueued: true, saleQueued: true, identityQueued: true })
  expect(await read(page)).toEqual(before)
  expect(before.permits[0].localState).toBe('AVAILABLE')
  expect(before.sales).toEqual([])
})

test('partial loss of Sale, permit, Authority, identity or markers never resurrects a permit', async ({ page }) => {
  for (const missing of ['sale', 'miskeyed-sale', 'permit', 'authority', 'identity', 'marker']) {
    await setup(page, 1)
    await page.evaluate(input => (globalThis as any).__commitSale(input), intent('loss-op'))
    await page.evaluate(async kind => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['identity', 'offlineMeta', 'offlineAuthorities', 'offlinePermits', 'offlineSales'], 'readwrite')
        if (kind === 'sale') tx.objectStore('offlineSales').delete('loss-op')
        if (kind === 'miskeyed-sale') { const store = tx.objectStore('offlineSales'); const r = store.get('loss-op'); r.onsuccess = () => { store.delete('loss-op'); store.put(r.result, 'wrong-key') } }
        if (kind === 'permit') tx.objectStore('offlinePermits').delete(['authority-1', 0])
        if (kind === 'authority') tx.objectStore('offlineAuthorities').delete('authority-1')
        if (kind === 'identity') tx.objectStore('identity').delete('current')
        if (kind === 'marker') { const r = tx.objectStore('offlineMeta').get('state'); r.onsuccess = () => tx.objectStore('offlineMeta').put({ ...r.result, saleOperationIds: [] }, 'state') }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
    }, missing)
    expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'ACCEPTED', (error: Error) => error.message), intent('loss-op'))).not.toBe('ACCEPTED')
    const after = await read(page)
    if (missing !== 'permit') expect(after.permits[0]?.localState).toBe('CONSUMED_LOCAL')
  }
})

test('pending rotation, promoted key, revocation, expiry and clock rollback block PREPARED finalization', async ({ page }) => {
  for (const mode of ['pending', 'promoted', 'authority-revoked', 'terminal-revoked', 'expired', 'rollback', 'missing-user']) {
    const { data } = await setup(page, 1)
    await page.evaluate(async input => {
      const original = SubtleCrypto.prototype.sign
      SubtleCrypto.prototype.sign = function (algorithm, key, bytes) {
        if (new TextDecoder().decode(bytes).startsWith('{')) throw new Error('pause before finalization')
        return original.call(this, algorithm, key, bytes)
      }
      try { await (globalThis as any).__commitSale(input) } catch { /* PREPARED remains durable */ }
      finally { SubtleCrypto.prototype.sign = original }
    }, intent('trust-op'))
    const prepared = await read(page)
    expect(prepared.sales[0].state).toBe('PREPARED')
    if (mode === 'pending') await page.evaluate(async () => import('/src/shared/offline/terminalIdentity.ts').then(m => m.prepareTerminalRotation('pending-command')))
    if (mode === 'promoted') await page.evaluate(async () => { const m = await import('/src/shared/offline/terminalIdentity.ts'); await m.prepareTerminalRotation('rotation-command'); await m.promoteTerminalRotation({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, commandId: 'rotation-command' }) })
    if (mode === 'authority-revoked' || mode === 'terminal-revoked') {
      const revoked = mode === 'authority-revoked' ? { ...data, authority: { ...data.authority, revoked: true, revocation: { revokedAt: new Date().toISOString(), revokedByUserId: 'manager-1', reason: 'revoked' } } } : data
      await mock(page, revoked, 'user-1', mode === 'terminal-revoked')
      await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1').catch(() => undefined)))
    }
    if (mode === 'missing-user') await page.evaluate(() => (globalThis as any).__logout())
    const outcome = await page.evaluate(async ({ input, mode, expiresAt, issuedAt }) => {
      const original = Date.now
      if (mode === 'expired') Date.now = () => new Date(expiresAt).getTime()
      if (mode === 'rollback') Date.now = () => new Date(issuedAt).getTime()
      try { return await (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message) }
      finally { Date.now = original }
    }, { input: intent('trust-op'), mode, expiresAt: data.authority.expiresAt, issuedAt: data.authority.issuedAt })
    expect(outcome, mode).not.toBe('COMMITTED')
    const after = await read(page)
    expect(after.sales[0].state, mode).toBe('PREPARED')
    expect(after.permits[0].localState, mode).toBe('RESERVED')
  }
})

test('two tabs converge on one operation and cannot consume the same permit for different operations', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage()
    await setup(a, 2)
    const b = await context.newPage()
    await b.goto('/')
    await mock(b, fixture(2))
    await mount(b)
    const [first, second] = await Promise.all([
      a.evaluate(input => (globalThis as any).__commitSale(input), intent('shared-op')),
      b.evaluate(input => (globalThis as any).__commitSale(input), intent('shared-op')),
    ])
    expect(second).toEqual(first)
    expect((await read(a)).sales).toHaveLength(1)
    const [otherA, otherB] = await Promise.all([
      a.evaluate(input => (globalThis as any).__commitSale(input).then((sale: any) => sale.envelope.permitSequence, (error: Error) => error.message), intent('different-a')),
      b.evaluate(input => (globalThis as any).__commitSale(input).then((sale: any) => sale.envelope.permitSequence, (error: Error) => error.message), intent('different-b')),
    ])
    expect([otherA, otherB].filter(value => value === 1)).toHaveLength(1)
    const state = await read(a)
    expect(state.sales).toHaveLength(2)
    expect(state.permits.map((permit: any) => permit.localState)).toEqual(['CONSUMED_LOCAL', 'CONSUMED_LOCAL'])
  } finally { await context.close() }
})

test('rotation during signing prevents final commit; committed historical evidence remains unchanged after rotation', async ({ page }) => {
  await setup(page, 2)
  const raced = await page.evaluate(async input => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = function (algorithm, key, bytes) {
      if (!new TextDecoder().decode(bytes).startsWith('{')) return original.call(this, algorithm, key, bytes)
      SubtleCrypto.prototype.sign = original
      return import('/src/shared/offline/terminalIdentity.ts').then(m => m.prepareTerminalRotation('during-sign')).then(() => original.call(this, algorithm, key, bytes))
    }
    try { return await (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message) }
    finally { SubtleCrypto.prototype.sign = original }
  }, intent('raced-op'))
  expect(raced).not.toBe('COMMITTED')
  const before = await read(page)
  expect(before.sales[0].state).toBe('PREPARED')
  expect(before.permits[0].localState).toBe('RESERVED')
  await page.evaluate(async () => { const m = await import('/src/shared/offline/terminalIdentity.ts'); await m.promoteTerminalRotation({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, commandId: 'during-sign' }) })
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message), intent('raced-op'))).not.toBe('COMMITTED')
  expect((await read(page)).sales[0]).toEqual(before.sales[0])

  await setup(page, 1)
  const committed = await page.evaluate(input => (globalThis as any).__commitSale(input), intent('historical-op'))
  await page.evaluate(async () => { const m = await import('/src/shared/offline/terminalIdentity.ts'); await m.prepareTerminalRotation('after-commit'); await m.promoteTerminalRotation({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, commandId: 'after-commit' }) })
  const exact = await page.evaluate(async input => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = function (algorithm, key, bytes) {
      if (new TextDecoder().decode(bytes).startsWith('{')) throw new Error('historical Sale was re-signed')
      return original.call(this, algorithm, key, bytes)
    }
    try { return await (globalThis as any).__commitSale(input) }
    finally { SubtleCrypto.prototype.sign = original }
  }, intent('historical-op'))
  expect(exact).toEqual(committed)
  expect((await read(page)).sales[0]).toEqual(committed)
})

test('current AuthSession is required; same user may resume PREPARED after reauthentication', async ({ page }) => {
  const { data } = await setup(page, 1)
  await mock(page, data, 'user-2')
  await page.evaluate(() => (globalThis as any).__refresh())
  await page.waitForFunction(() => (globalThis as any).__authUser === 'user-2')
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message), intent('auth-op'))).not.toBe('COMMITTED')
  expect((await read(page)).sales).toEqual([])
  await mock(page, data)
  await page.evaluate(() => (globalThis as any).__refresh())
  await page.waitForFunction(() => (globalThis as any).__authUser === 'user-1')
  await page.evaluate(async input => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = function (algorithm, key, bytes) {
      if (new TextDecoder().decode(bytes).startsWith('{')) throw new Error('interrupt')
      return original.call(this, algorithm, key, bytes)
    }
    try { await (globalThis as any).__commitSale(input) } catch { /* PREPARED persists */ }
    finally { SubtleCrypto.prototype.sign = original }
  }, intent('auth-op'))
  const before = await read(page)
  expect(before.sales[0].state).toBe('PREPARED')
  await page.evaluate(() => (globalThis as any).__logout())
  await page.waitForFunction(() => (globalThis as any).__authUser === undefined)
  expect(await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message), intent('auth-op'))).not.toBe('COMMITTED')
  expect((await read(page)).sales[0]).toEqual(before.sales[0])
  await page.evaluate(() => (globalThis as any).__refresh())
  await page.waitForFunction(() => (globalThis as any).__authUser === 'user-1')
  expect((await page.evaluate(input => (globalThis as any).__commitSale(input), intent('auth-op'))).state).toBe('COMMITTED_LOCAL')
})

test('Stage D marker detects missing PREPARED Sale and missing reserved permit', async ({ page }) => {
  for (const missing of ['sale', 'permit']) {
    await setup(page, 1)
    await page.evaluate(async input => {
      const original = SubtleCrypto.prototype.sign
      SubtleCrypto.prototype.sign = function (algorithm, key, bytes) {
        if (new TextDecoder().decode(bytes).startsWith('{')) throw new Error('interrupt')
        return original.call(this, algorithm, key, bytes)
      }
      try { await (globalThis as any).__commitSale(input) } catch { /* PREPARED persists */ }
      finally { SubtleCrypto.prototype.sign = original }
    }, intent('prepared-loss-op'))
    await page.evaluate(async kind => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['offlineSales', 'offlinePermits'], 'readwrite')
        if (kind === 'sale') tx.objectStore('offlineSales').delete('prepared-loss-op')
        else tx.objectStore('offlinePermits').delete(['authority-1', 0])
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
    }, missing)
    const result = await page.evaluate(input => (globalThis as any).__commitSale(input).then(() => 'COMMITTED', (error: Error) => error.message), intent('prepared-loss-op'))
    expect(result).toBe('OFFLINE_STATE_LOST')
  }
})

test('full local database clear is operational data loss, not Sale restoration', async ({ page }) => {
  await setup(page, 1)
  await page.evaluate(input => (globalThis as any).__commitSale(input), intent('lost-forever'))
  await reset(page)
  await mock(page, fixture(1))
  const state = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts').then(m => m.loadTerminalIdentity())
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const sales = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('offlineSales', 'readonly').objectStore('offlineSales').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    db.close()
    return { identity, sales }
  })
  expect(state).toEqual({ identity: undefined, sales: [] })
})

test('final transaction holding identity store commits before queued rotation', async ({ page }) => {
  await setup(page, 1)
  const raced = await page.evaluate(async input => {
    const original = IDBObjectStore.prototype.put
    let rotation: Promise<unknown> | undefined
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      if (this.name === 'offlineSales' && value?.state === 'COMMITTED_LOCAL' && !rotation) {
        rotation = import('/src/shared/offline/terminalIdentity.ts').then(m => m.prepareTerminalRotation('queued-after-final'))
      }
      return original.call(this, value, key!)
    }
    try {
      const committed = await (globalThis as any).__commitSale(input)
      const pending = await rotation
      return { committed, pending }
    } finally { IDBObjectStore.prototype.put = original }
  }, intent('transaction-first'))
  expect(raced.committed.state).toBe('COMMITTED_LOCAL')
  expect(raced.pending).toMatchObject({ kind: 'rotation', commandId: 'queued-after-final' })
  const state = await read(page)
  expect(state.sales[0]).toEqual(raced.committed)
  expect(state.permits[0].localState).toBe('CONSUMED_LOCAL')
})
