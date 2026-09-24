import { expect, test, type Page } from '@playwright/test'

const dbName = 'madina-crm:retail-offline-terminal-identity:v1'

async function setup(page: Page, commit = true, permitCount = 1) {
  await page.goto('/')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName)
  await page.evaluate(permitCount => {
    const authority = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 125 }], permits: Array.from({ length: permitCount }, (_, sequence) => ({ permitId: `permit-${sequence}`, sequence, status: 'AVAILABLE' })), permitCounts: { available: permitCount, conflictPending: 0, accepted: 0 } }
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'user-1', username: 'user-1', role: 'manager' } }), { headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/offline-terminals')) return new Response(JSON.stringify({ terminal: { ...(path.endsWith('/offline-terminals') ? { id: 'terminal-1' } : { terminalId: 'terminal-1' }), locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify(path.endsWith('/permits') ? { permits: authority.permits } : { authority }), { headers: { 'Content-Type': 'application/json' } })
    }
  }, permitCount)
  await page.evaluate(async () => {
    await import('/src/shared/offline/terminalProvisioning.ts').then(m => m.beginTerminalEnrollment('location-1'))
    await import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1'))
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDom } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { AuthProvider } = await import('/src/context/AuthProvider.tsx')
    const { useAuth } = await import('/src/context/useAuth.ts')
    const { useCommitOfflineSale } = await import('/src/shared/offline/offlineLocalSale.ts')
    function Probe() { (globalThis as any).__commitSale = useCommitOfflineSale(); (globalThis as any).__user = useAuth().user?.id; return null }
    const node = document.createElement('div'); document.body.append(node)
    ReactDom.createRoot(node).render(React.createElement(AuthProvider, null, React.createElement(Probe)))
    await new Promise<void>((resolve, reject) => { let n = 0; const tick = () => (globalThis as any).__user ? resolve() : ++n > 100 ? reject(new Error('Auth unavailable')) : setTimeout(tick, 10); tick() })
  })
  if (commit) await page.evaluate(() => (globalThis as any).__commitSale({ authorityId: 'authority-1', operationId: 'projection-op', lines: [{ productId: 'product-1', quantity: 2 }] }))
}

async function projection(page: Page) {
  return page.evaluate(() => import('/src/shared/offline/offlineOperationsProjection.ts').then(m => m.readLocalOfflineOperations()))
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const names = ['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales', 'offlineSaleSync']
    const tx = db.transaction(names, 'readonly')
    const result = await Promise.all(names.map(name => new Promise<any[]>((resolve, reject) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
    db.close()
    return Object.fromEntries(names.map((name, index) => [name, result[index]])) as Record<string, any[]>
  })
}

async function validLegacyV3(page: Page) {
  await page.goto('/')
  await page.evaluate(async name => {
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) })
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))))
    const authority = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, productPrices: [{ productId: 'product-1', unitPriceMinor: 125 }] }
    const envelope = { schemaVersion: 1, offlineOperationId: 'v3-op', authorityId: 'authority-1', authorityVersion: 1, permitId: 'permit-0', permitSequence: 0, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', proposedSaleId: 'v3-op', lines: [{ id: 'v3-line', productId: 'product-1', quantity: 1, unitPriceMinor: 125 }], currencyCode: 'USD', currencyExponent: 2, cashAllocation: { id: 'v3-payment', method: 'cash', amountMinor: 125, ordinal: 0 }, subtotalMinor: 125, payableTotalMinor: 125, claimedOfflineCompletedAt: new Date().toISOString() }
    const sale = { state: 'PREPARED', intent: { authorityId: 'authority-1', lines: [{ productId: 'product-1', quantity: 1 }] }, envelope, publicKey, authoritySnapshot: authority }
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onupgradeneeded = () => { for (const store of ['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales']) r.result.createObjectStore(store) }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales'], 'readwrite')
      tx.objectStore('identity').put({ version: 1, publicKeyAlgorithm: 'ed25519-spki-der-base64-v1', privateKey: pair.privateKey, publicKey, terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, offlineStateEverInstalled: true, offlineSaleEverPrepared: true }, 'current')
      tx.objectStore('offlineAuthorities').put({ snapshot: authority, knownRevoked: false }, 'authority-1')
      tx.objectStore('offlinePermits').put({ authorityId: 'authority-1', permitId: 'permit-0', sequence: 0, serverStatus: 'AVAILABLE', localState: 'RESERVED', operationId: 'v3-op' }, ['authority-1', 0])
      tx.objectStore('offlineMeta').put({ version: 1, terminalId: 'terminal-1', locationId: 'location-1', authorityIds: ['authority-1'], saleOperationIds: ['v3-op'], lastObservedMs: Date.now(), knownTerminalUnsafe: false }, 'state')
      tx.objectStore('offlineSales').put(sale, 'v3-op')
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, dbName)
}

async function projectDuringIdentityRace(page: Page, changeInOtherTab: () => Promise<unknown>) {
  await page.exposeFunction('__duringDiagnosticVerification', changeInOtherTab)
  return page.evaluate(async () => {
    const original = SubtleCrypto.prototype.sign
    let interleaved = false
    SubtleCrypto.prototype.sign = function (algorithm, key, data) {
      if (!interleaved && new TextDecoder().decode(data).startsWith('madina-retail-offline-terminal-keypair-consistency-v1')) {
        interleaved = true
        return (async () => { await (globalThis as any).__duringDiagnosticVerification(); return original.call(this, algorithm, key, data) })()
      }
      return original.call(this, algorithm, key, data)
    }
    try { return await import('/src/shared/offline/offlineOperationsProjection.ts').then(m => m.readLocalOfflineOperations()) }
    finally { SubtleCrypto.prototype.sign = original }
  })
}

async function serverReply(page: Page, kind: 'accepted' | 'replay' | 'retry' | 'network' | 'auth' | 'access' | 'review' | 'review-required' | 'conflict' | 'rejected') {
  await page.evaluate(kind => {
    const prior = globalThis.fetch
    ;(globalThis as any).__syncCalls = 0
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('/offline-sales/sync')) return prior(url, options)
      ;(globalThis as any).__syncCalls++
      const envelope = JSON.parse(String(options?.body)).envelope
      const error = (status: number, message: string) => new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } })
      if (kind === 'retry') return error(520, 'arbitrary sensitive upstream details')
      if (kind === 'network') throw new TypeError('raw network details')
      if (kind === 'auth') return error(401, 'raw session details')
      if (kind === 'access') return error(403, 'raw access details')
      if (kind === 'review') return error(409, 'unknown sensitive server conflict')
      if (kind === 'review-required') return error(409, 'RETAIL_OFFLINE_REVIEW_REQUIRED')
      if (kind === 'conflict') return error(409, 'VERIFIED_OFFLINE_STOCK_CONFLICT')
      if (kind === 'rejected') return error(409, 'IDEMPOTENCY_CONFLICT')
      return new Response(JSON.stringify({
        sale: { id: envelope.proposedSaleId, location_id: envelope.locationId, status: 'completed', currency_code: envelope.currencyCode, currency_exponent: envelope.currencyExponent, subtotal_minor: envelope.subtotalMinor, payable_total_minor: envelope.payableTotalMinor },
        items: envelope.lines.map((line: any) => ({ id: line.id, sale_id: envelope.proposedSaleId, product_id: line.productId, quantity: line.quantity, unit_price_minor: line.unitPriceMinor, line_total_minor: line.quantity * line.unitPriceMinor })),
        allocations: [{ id: envelope.cashAllocation.id, sale_id: envelope.proposedSaleId, method: 'cash', amount_minor: envelope.payableTotalMinor, ordinal: 0 }],
      }), { status: kind === 'replay' ? 200 : 201, headers: { 'Content-Type': 'application/json' } })
    }
  }, kind)
}

async function sync(page: Page) {
  return page.evaluate(() => import('/src/shared/offline/offlineSaleSync.ts').then(m => m.syncPendingOfflineSales()))
}

test('clean and uninitialized profiles, then a committed Sale waiting for first delivery', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName)
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)), dbName)).toBeUndefined()
  expect(await projection(page)).toEqual({ state: 'UNINITIALIZED', operations: [], preparedCount: 0, pendingCount: 0, retryCount: 0, attentionCount: 0 })
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)), dbName)).toBeUndefined()
  await setup(page, false)
  expect(await projection(page)).toMatchObject({ state: 'ENROLLED', terminalId: 'terminal-1', locationId: 'location-1', operations: [], pendingCount: 0, attentionCount: 0 })
  await page.evaluate(() => (globalThis as any).__commitSale({ authorityId: 'authority-1', operationId: 'projection-op', lines: [{ productId: 'product-1', quantity: 2 }] }))
  expect(await projection(page)).toMatchObject({ pendingCount: 1, retryCount: 0, attentionCount: 0, operations: [{ operationId: 'projection-op', proposedSaleId: 'projection-op', state: 'WAITING_FIRST_DELIVERY', attemptCount: 0, result: 'NOT_ATTEMPTED' }] })
})

test('a valid legacy v3 profile is bounded and not upgraded or given fabricated sync state', async ({ page }) => {
  await validLegacyV3(page)
  const before = await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction(['identity', 'offlineMeta', 'offlineSales'], 'readonly')
    const read = (store: string) => new Promise<any[]>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const result = await Promise.all(['identity', 'offlineMeta', 'offlineSales'].map(read)); db.close(); return result
  }, dbName)
  expect(await projection(page)).toEqual({ state: 'LEGACY_SCHEMA', schemaVersion: 3 })
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)?.version), dbName)).toBe(3)
  expect(await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction(['identity', 'offlineMeta', 'offlineSales'], 'readonly')
    const read = (store: string) => new Promise<any[]>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const result = await Promise.all(['identity', 'offlineMeta', 'offlineSales'].map(read)); const stores = Array.from(db.objectStoreNames); db.close(); return { result, stores }
  }, dbName)).toEqual({ result: before, stores: ['identity', 'offlineAuthorities', 'offlineMeta', 'offlinePermits', 'offlineSales'] })
})

test('malformed legacy v3 remains fail-closed and is not upgraded', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async name => {
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 3)
      r.onupgradeneeded = () => r.result.createObjectStore('identity')
      r.onsuccess = () => { r.result.close(); resolve() }
      r.onerror = () => reject(r.error)
    })
  }, dbName)
  expect(await projection(page)).toEqual({ state: 'OFFLINE_STATE_LOST' })
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)?.version), dbName)).toBe(3)
  await validLegacyV3(page)
  await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('offlineMeta', 'readwrite'); const r = tx.objectStore('offlineMeta').get('state'); r.onsuccess = () => tx.objectStore('offlineMeta').put({ ...r.result, saleOperationIds: ['wrong-op'] }, 'state'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  }, dbName)
  expect(await projection(page)).toEqual({ state: 'OFFLINE_STATE_LOST' })
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)?.version), dbName)).toBe(3)
})

test('a persisted PREPARED Sale is visible but never reported as committed or sync-pending', async ({ page }) => {
  await setup(page, false)
  await page.evaluate(async () => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = function (algorithm, key, data) {
      if (new TextDecoder().decode(data).startsWith('madina-retail-offline-terminal-keypair-consistency-v1')) return original.call(this, algorithm, key, data)
      throw new Error('stop after prepare')
    }
    try { await (globalThis as any).__commitSale({ authorityId: 'authority-1', operationId: 'projection-op', lines: [{ productId: 'product-1', quantity: 2 }] }).catch(() => undefined) }
    finally { SubtleCrypto.prototype.sign = original }
  })
  expect(await projection(page)).toMatchObject({ state: 'ENROLLED', preparedCount: 1, pendingCount: 0, attentionCount: 1, operations: [{ state: 'PREPARED', result: 'NOT_COMMITTED', attemptCount: 0 }] })
  const value = await projection(page)
  if (value.state !== 'ENROLLED') throw new Error('Unexpected integrity loss')
  expect(value.operations[0]?.committedAt).toBeUndefined()
})

test('a generated key cannot conceal a lost prior offline-state marker', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName)
  await page.evaluate(() => import('/src/shared/offline/terminalIdentity.ts').then(m => m.generateTerminalIdentity()))
  expect(await projection(page)).toMatchObject({ state: 'KEY_GENERATED', operations: [], preparedCount: 0 })
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('identity', 'readwrite')
      const store = tx.objectStore('identity')
      const r = store.get('current')
      r.onsuccess = () => store.put({ ...r.result, offlineStateEverInstalled: true }, 'current')
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  expect(await projection(page)).toEqual({ state: 'OFFLINE_STATE_LOST' })
})

test('production sync outcomes project every retry, hold, and terminal classification', async ({ page }) => {
  for (const [reply, state, result, pending, attention] of [
    ['retry', 'RETRY_WAIT', 'SERVER_FAILURE', 1, 0],
    ['network', 'RETRY_WAIT', 'NO_HTTP_RESULT', 1, 0],
    ['auth', 'AUTH_HOLD', 'AUTH_REQUIRED', 1, 1],
    ['access', 'ACCESS_HOLD', 'ACCESS_DENIED', 1, 1],
    ['review', 'REVIEW_HOLD', 'OTHER_RESPONSE', 1, 1],
    ['review-required', 'REVIEW_HOLD', 'REVIEW_REQUIRED', 1, 1],
    ['accepted', 'ACCEPTED', 'FIRST_ACCEPTANCE', 0, 0],
    ['replay', 'ACCEPTED', 'EXACT_REPLAY', 0, 0],
    ['conflict', 'STOCK_CONFLICT', 'VERIFIED_STOCK_CONFLICT', 0, 1],
    ['rejected', 'HARD_REJECTED', 'IDEMPOTENCY_CONFLICT', 0, 1],
  ] as const) {
    await setup(page)
    await serverReply(page, reply)
    await sync(page)
    const value = await projection(page)
    expect(value, reply).toMatchObject({ state: 'ENROLLED', pendingCount: pending, retryCount: state === 'RETRY_WAIT' ? 1 : 0, attentionCount: attention, operations: [{ state, result, attemptCount: 1 }] })
    if (value.state !== 'ENROLLED') throw new Error('Unexpected integrity loss')
    expect(value.operations).toHaveLength(1)
    expect(value.operations[0]?.lastAttemptAt).toBeGreaterThan(0)
    if (reply === 'retry') {
      expect(value.operations[0]?.nextAttemptAt).toBeGreaterThan(value.operations[0]!.lastAttemptAt!)
      expect(value.operations[0]?.lastHttpStatus).toBe(520)
    }
    if (reply === 'network') expect(value.operations[0]?.lastHttpStatus).toBeUndefined()
    if (reply === 'accepted') expect(value.lastLocallyObservedAcceptance).toMatchObject({ operationId: 'projection-op', clientObservedAt: value.operations[0]?.clientObservedAt })
  }
})

test('terminal marker loss, incompatible kind, and swapped public key fail closed with no partial list or resend', async ({ page }) => {
  for (const damage of ['missing', 'wrong-kind', 'swapped-key'] as const) {
    await setup(page); await serverReply(page, 'accepted'); await sync(page)
    await page.evaluate(async damage => {
      let swappedPublicKey: string | undefined
      if (damage === 'swapped-key') {
        const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
        const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
        swappedPublicKey = btoa(String.fromCharCode(...new Uint8Array(spki)))
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => {
        const store = damage === 'swapped-key' ? 'identity' : 'offlineMeta'
        const key = damage === 'swapped-key' ? 'current' : 'state'
        const tx = db.transaction(store, 'readwrite')
        const request = tx.objectStore(store).get(key)
        request.onsuccess = () => {
          if (damage === 'swapped-key') {
            tx.objectStore(store).put({ ...request.result, publicKey: swappedPublicKey }, key)
          } else tx.objectStore(store).put({ ...request.result, terminalSyncOutcomes: damage === 'missing' ? [] : [{ operationId: 'projection-op', kind: 'STOCK_CONFLICT' }] }, key)
        }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
      })
      db.close()
    }, damage)
    const before = await page.evaluate(() => (globalThis as any).__syncCalls)
    expect(await projection(page)).toEqual({ state: 'OFFLINE_STATE_LOST' })
    expect(await page.evaluate(() => (globalThis as any).__syncCalls)).toBe(before)
  }
})

test('one corrupted result among two real operations never yields a partial healthy list', async ({ page }) => {
  await setup(page, false, 2)
  for (const operationId of ['projection-op-a', 'projection-op-b']) await page.evaluate(operationId => (globalThis as any).__commitSale({ authorityId: 'authority-1', operationId, lines: [{ productId: 'product-1', quantity: 1 }] }), operationId)
  await serverReply(page, 'accepted'); await sync(page)
  const healthy = await projection(page)
  if (healthy.state !== 'ENROLLED') throw new Error('Expected two healthy operations')
  expect(healthy.operations).toHaveLength(2)
  await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('offlineMeta', 'readwrite'); const r = tx.objectStore('offlineMeta').get('state'); r.onsuccess = () => tx.objectStore('offlineMeta').put({ ...r.result, terminalSyncOutcomes: r.result.terminalSyncOutcomes.filter((item: any) => item.operationId !== 'projection-op-b') }, 'state'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  }, dbName)
  expect(await projection(page)).toEqual({ state: 'OFFLINE_STATE_LOST' })
})

test('deletion during diagnostic verification cannot recreate the database', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a, false)
    const b = await context.newPage(); await b.goto('/')
    const result = await projectDuringIdentityRace(a, () => b.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName))
    expect(result).toEqual({ state: 'OFFLINE_STATE_LOST' })
    expect(await b.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)), dbName)).toBeUndefined()
  } finally { await context.close() }
})

test('replacement with older schema during observation cannot cause a diagnostic upgrade', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a, false)
    const b = await context.newPage(); await b.goto('/')
    const result = await projectDuringIdentityRace(a, () => b.evaluate(async name => {
      await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onupgradeneeded = () => r.result.createObjectStore('identity'); r.onsuccess = () => { r.result.close(); resolve() }; r.onerror = () => reject(r.error) })
    }, dbName))
    expect(result).toEqual({ state: 'OFFLINE_STATE_LOST' })
    expect(await b.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)?.version), dbName)).toBe(3)
    expect(await b.evaluate(async name => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }); const stores = Array.from(db.objectStoreNames); db.close(); return stores }, dbName)).toEqual(['identity'])
  } finally { await context.close() }
})

test('schema advancement during observation fails closed without diagnostic writes', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a, false)
    const b = await context.newPage(); await b.goto('/')
    const result = await projectDuringIdentityRace(a, () => b.evaluate(async name => {
      await new Promise<void>((resolve, reject) => { const r = indexedDB.open(name, 5); r.onupgradeneeded = () => r.result.createObjectStore('futureSchema'); r.onsuccess = () => { r.result.close(); resolve() }; r.onerror = () => reject(r.error) })
    }, dbName))
    expect(result).toEqual({ state: 'OFFLINE_STATE_LOST' })
    expect(await b.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)?.version), dbName)).toBe(5)
  } finally { await context.close() }
})

test('reload preserves diagnostic derivation, without diagnostic persistence or evidence exposure', async ({ page }) => {
  await setup(page); await serverReply(page, 'accepted'); await sync(page)
  const before = await stored(page)
  const first = await projection(page)
  await page.reload()
  const reloaded = await projection(page)
  expect(reloaded).toEqual(first)
  expect(await stored(page)).toEqual(before)
  if (reloaded.state !== 'ENROLLED') throw new Error('Unexpected integrity loss')
  const text = JSON.stringify(reloaded)
  expect(text).not.toContain(before.offlineSales[0].canonicalPayload)
  expect(text).not.toContain(before.offlineSales[0].payloadHash)
  expect(text).not.toContain(before.offlineSales[0].signature)
  expect(text).not.toContain(before.identity[0].publicKey)
  for (const forbidden of ['privateKey', 'canonicalPayload', 'payloadHash', 'signature', 'envelope', 'lastMessage', 'accessToken', 'cookie']) expect(text).not.toContain(forbidden)
  expect(Object.keys(before)).not.toContain('offlineOperationsProjection')
})

test('projection is strictly observational and two tabs see one logical operation', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a); await serverReply(a, 'retry'); await sync(a)
    const b = await context.newPage(); await b.goto('/')
    const before = await stored(a)
    const [left, right] = await Promise.all([projection(a), projection(b)])
    expect(left).toEqual(right)
    if (left.state !== 'ENROLLED') throw new Error('Unexpected integrity loss')
    expect(left.operations).toHaveLength(1)
    expect(await stored(a)).toEqual(before)
    expect(await a.evaluate(() => (globalThis as any).__syncCalls)).toBe(1)
    const mode = await a.evaluate(async () => {
      const original = IDBDatabase.prototype.transaction
      IDBDatabase.prototype.transaction = function (...args) { if (args[1] !== 'readonly') throw new Error('Diagnostic attempted a write transaction'); return original.apply(this, args) }
      try { return await import('/src/shared/offline/offlineOperationsProjection.ts').then(m => m.readLocalOfflineOperations()) }
      finally { IDBDatabase.prototype.transaction = original }
    })
    expect(mode).toEqual(left)
    expect(await stored(a)).toEqual(before)
  } finally { await context.close() }
})
