import { expect, test, type Page } from '@playwright/test'

const dbName = 'madina-crm:retail-offline-terminal-identity:v1'
const input = (operationId = 'sync-op') => ({ authorityId: 'authority-1', operationId, lines: [{ productId: 'product-1', quantity: 2 }] })

async function setup(page: Page) {
  await page.goto('/')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) }, dbName)
  await page.evaluate(() => {
    const authority = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 125 }], permits: [{ permitId: 'permit-0', sequence: 0, status: 'AVAILABLE' }], permitCounts: { available: 1, conflictPending: 0, accepted: 0 } }
    globalThis.fetch = async url => {
      const path = String(url)
      if (path.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'user-1', username: 'user-1', role: 'manager' } }), { headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/offline-terminals')) return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify(path.endsWith('/permits') ? { permits: authority.permits } : { authority }), { headers: { 'Content-Type': 'application/json' } })
    }
  })
  await page.evaluate(async () => {
    await import('/src/shared/offline/terminalProvisioning.ts').then(m => m.beginTerminalEnrollment('location-1'))
    await import('/src/shared/offline/offlineAuthorityLedger.ts').then(m => m.installOfflineAuthority('location-1', 'authority-1', 'user-1'))
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDom } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { AuthProvider } = await import('/src/context/AuthProvider.tsx')
    const { useAuth } = await import('/src/context/useAuth.ts')
    const { useCommitOfflineSale } = await import('/src/shared/offline/offlineLocalSale.ts')
    function Probe() { (globalThis as any).__commitSale = useCommitOfflineSale(); (globalThis as any).__user = useAuth().user?.id; return null }
    const element = document.createElement('div'); document.body.append(element)
    ReactDom.createRoot(element).render(React.createElement(AuthProvider, null, React.createElement(Probe)))
    await new Promise<void>((resolve, reject) => { let tries = 0; const check = () => (globalThis as any).__user ? resolve() : ++tries > 100 ? reject(new Error('Auth unavailable')) : setTimeout(check, 10); check() })
  })
  await page.evaluate(value => (globalThis as any).__commitSale(value), input())
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction(['identity', 'offlineMeta', 'offlineSales', 'offlineSaleSync'], 'readonly')
    const one = (store: string) => new Promise<any>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const [identity, meta, sales, sync] = await Promise.all(['identity', 'offlineMeta', 'offlineSales', 'offlineSaleSync'].map(one))
    db.close()
    return { identity: { marker: identity[0]?.offlineSyncEverTerminal, publicKey: identity[0]?.publicKey }, meta: meta[0], sales, sync }
  })
}

async function sync(page: Page, resumeAccessHolds = false) {
  return page.evaluate(value => import('/src/shared/offline/offlineSaleSync.ts').then(m => m.syncPendingOfflineSales({ resumeAccessHolds: value })), resumeAccessHolds)
}

async function advanceAndSync(page: Page, resumeAccessHolds = false) {
  return page.evaluate(async value => {
    const original = Date.now
    Date.now = () => original() + 600_000
    try { return await import('/src/shared/offline/offlineSaleSync.ts').then(m => m.syncPendingOfflineSales({ resumeAccessHolds: value })) }
    finally { Date.now = original }
  }, resumeAccessHolds)
}

async function mockSync(page: Page, mode: 'accept' | 'lost-accept' | 'conflict' | 'lost-conflict' | 'materialized' | 'reject' | 'network' | 'server-520' | 'auth' | 'access' | 'unknown') {
  await page.evaluate(mode => {
    const old = globalThis.fetch
    let calls = 0, effects = 0
    ;(globalThis as any).__syncObserved = { calls: 0, effects: 0, urls: [] as string[], payloads: [] as any[] }
    globalThis.fetch = async (url, options) => {
      const path = String(url)
      if (!path.includes('/offline-sales/sync') && !path.endsWith('/offline-stock-conflicts')) return old(url, options)
      if (path.endsWith('/offline-stock-conflicts')) {
        const envelope = (globalThis as any).__syncObserved.payloads[0].envelope
        return new Response(JSON.stringify({ conflicts: mode === 'materialized' ? [{ offlineOperationId: envelope.offlineOperationId, saleId: envelope.proposedSaleId, saleItemId: envelope.lines[0].id, productId: envelope.lines[0].productId }] : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      calls++
      const observed = (globalThis as any).__syncObserved
      observed.calls = calls; observed.urls.push(path)
      const payload = JSON.parse(String(options?.body)); observed.payloads.push(payload)
      const envelope = payload.envelope
      const accepted = () => new Response(JSON.stringify({ sale: { id: envelope.proposedSaleId, location_id: envelope.locationId, status: 'completed', currency_code: envelope.currencyCode, currency_exponent: envelope.currencyExponent, subtotal_minor: envelope.subtotalMinor, payable_total_minor: envelope.payableTotalMinor }, items: envelope.lines.map((line: any) => ({ id: line.id, sale_id: envelope.proposedSaleId, product_id: line.productId, quantity: line.quantity, unit_price_minor: line.unitPriceMinor, line_total_minor: line.quantity * line.unitPriceMinor })), allocations: [{ id: envelope.cashAllocation.id, sale_id: envelope.proposedSaleId, method: 'cash', amount_minor: envelope.payableTotalMinor, ordinal: 0 }] }), { status: calls === 1 ? 201 : 200, headers: { 'Content-Type': 'application/json' } })
      const error = (status: number, message: string) => new Response(JSON.stringify({ statusCode: status, error: status === 409 ? 'Conflict' : 'Error', message }), { status, headers: { 'Content-Type': 'application/json' } })
      if (mode === 'accept' || mode === 'lost-accept') { if (!effects++) { observed.effects = 1; if (mode === 'lost-accept') throw new TypeError('lost response after server commit') } return accepted() }
      if (mode === 'conflict' || mode === 'lost-conflict') { if (!effects++) { observed.effects = 1; if (mode === 'lost-conflict') throw new TypeError('lost conflict response') } return error(409, 'VERIFIED_OFFLINE_STOCK_CONFLICT') }
      if (mode === 'materialized') { if (!effects++) { observed.effects = 1; throw new TypeError('lost response') } return error(409, 'RETAIL_OFFLINE_REVIEW_REQUIRED') }
      if (mode === 'reject') return error(409, 'IDEMPOTENCY_CONFLICT')
      if (mode === 'network') throw new TypeError('network unavailable')
      if (mode === 'server-520') return calls === 1 ? error(520, 'Temporary upstream failure.') : accepted()
      if (mode === 'auth') return error(401, 'Authentication required.')
      if (mode === 'access') return error(403, 'Retail permission denied.')
      return error(409, 'unclassified server conflict')
    }
  }, mode)
}

async function delaySyncResponse(page: Page) {
  await page.evaluate(() => {
    const prior = globalThis.fetch
    ;(globalThis as any).__delayedSyncCalls = 0
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('/offline-sales/sync')) return prior(url, options)
      const envelope = JSON.parse(String(options?.body)).envelope
      ;(globalThis as any).__delayedSyncCalls++
      return new Promise<Response>(resolve => {
        ;(globalThis as any).__releaseSync = (kind: 'accepted' | 'conflict', status: number) => {
          if (kind === 'conflict') return resolve(new Response(JSON.stringify({ message: 'VERIFIED_OFFLINE_STOCK_CONFLICT' }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
          resolve(new Response(JSON.stringify({ sale: { id: envelope.proposedSaleId, location_id: envelope.locationId, status: 'completed', currency_code: envelope.currencyCode, currency_exponent: envelope.currencyExponent, subtotal_minor: envelope.subtotalMinor, payable_total_minor: envelope.payableTotalMinor }, items: envelope.lines.map((line: any) => ({ id: line.id, sale_id: envelope.proposedSaleId, product_id: line.productId, quantity: line.quantity, unit_price_minor: line.unitPriceMinor, line_total_minor: line.quantity * line.unitPriceMinor })), allocations: [{ id: envelope.cashAllocation.id, sale_id: envelope.proposedSaleId, method: 'cash', amount_minor: envelope.payableTotalMinor, ordinal: 0 }] }), { status, headers: { 'Content-Type': 'application/json' } }))
        }
      })
    }
  })
}

test('discovery after reload sends exact evidence once, validates 201 and never re-signs', async ({ page }) => {
  await setup(page)
  const before = await state(page)
  await page.reload()
  await page.evaluate(async () => { const identity = await import('/src/shared/offline/terminalIdentity.ts'); await identity.prepareTerminalRotation('sync-rotation'); await identity.promoteTerminalRotation({ terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, commandId: 'sync-rotation' }) })
  await mockSync(page, 'accept')
  const result = await page.evaluate(async () => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = () => { throw new Error('sync attempted to sign') }
    try { return await import('/src/shared/offline/offlineSaleSync.ts').then(m => m.syncPendingOfflineSales()) }
    finally { SubtleCrypto.prototype.sign = original }
  })
  expect(result.attempted).toBe(1)
  const after = await state(page)
  expect(after.sales).toEqual(before.sales)
  expect(after.identity.publicKey).not.toBe(before.identity.publicKey)
  expect(after.sync[0]).toMatchObject({ kind: 'ACCEPTED', serverSaleId: 'sync-op', lastStatus: 201 })
  expect(after.identity.marker).toBe(true)
  expect(after.meta.terminalSyncOutcomes).toEqual([{ operationId: 'sync-op', kind: 'ACCEPTED' }])
  expect(await page.evaluate(() => (globalThis as any).__syncObserved)).toMatchObject({ calls: 1, urls: ['/api/v1/retail/locations/location-1/offline-sales/sync'] })
  expect(await sync(page)).toMatchObject({ attempted: 0 })
})

test('lost accepted response retries exact evidence and has one server effect', async ({ page }) => {
  await setup(page); const before = await state(page); await mockSync(page, 'lost-accept')
  expect(await sync(page)).toMatchObject({ attempted: 1 })
  expect((await state(page)).sync[0]).toMatchObject({ kind: 'RETRY_WAIT', attemptCount: 1 })
  expect(await advanceAndSync(page)).toMatchObject({ attempted: 1 })
  expect((await state(page)).sync[0]).toMatchObject({ kind: 'ACCEPTED', lastStatus: 200 })
  const observed = await page.evaluate(() => (globalThis as any).__syncObserved)
  expect(observed).toMatchObject({ calls: 2, effects: 1 })
  expect(observed.payloads[1]).toEqual(observed.payloads[0])
  expect((await state(page)).sales).toEqual(before.sales)
  await page.reload(); expect((await state(page)).sync[0].kind).toBe('ACCEPTED')
})

test('non-enumerated HTTP 520 persists backoff and automatically retries exact committed evidence', async ({ page }) => {
  await setup(page)
  const before = await state(page)
  await mockSync(page, 'server-520')
  expect(await sync(page)).toMatchObject({ attempted: 1 })
  const waiting = (await state(page)).sync[0]
  expect(waiting).toMatchObject({ kind: 'RETRY_WAIT', lastStatus: 520, attemptCount: 1 })
  expect(waiting.nextAttemptAt).toBeGreaterThan(waiting.lastAttemptAt)
  expect(await sync(page)).toMatchObject({ attempted: 0 })
  expect(await advanceAndSync(page)).toMatchObject({ attempted: 1 })
  const after = await state(page)
  expect(after.sync[0]).toMatchObject({ kind: 'ACCEPTED', lastStatus: 200, attemptCount: 2, serverSaleId: 'sync-op' })
  expect(after.sales).toEqual(before.sales)
  expect(after.meta.terminalSyncOutcomes).toEqual([{ operationId: 'sync-op', kind: 'ACCEPTED' }])
  const observed = await page.evaluate(() => (globalThis as any).__syncObserved)
  expect(observed.calls).toBe(2)
  expect(observed.payloads[1]).toEqual(observed.payloads[0])
})

test('stock conflict, lost conflict response, and materialized-before-retry remain conflict outcomes', async ({ page }) => {
  for (const mode of ['conflict', 'lost-conflict', 'materialized'] as const) {
    await setup(page); const before = await state(page); await mockSync(page, mode)
    await sync(page)
    if (mode !== 'conflict') await advanceAndSync(page)
    const after = await state(page)
    expect(after.sync[0].kind, mode).toBe('STOCK_CONFLICT')
    expect(after.sales, mode).toEqual(before.sales)
    expect(after.sync[0].lastMessage, mode).toBe('VERIFIED_OFFLINE_STOCK_CONFLICT')
    expect((await sync(page)).attempted, mode).toBe(0)
  }
})

test('hard rejection, auth/access holds, unknown conflict and network retry are distinct and monotonic', async ({ page }) => {
  for (const [mode, kind] of [['reject', 'HARD_REJECTED'], ['auth', 'AUTH_HOLD'], ['access', 'ACCESS_HOLD'], ['unknown', 'REVIEW_HOLD'], ['network', 'RETRY_WAIT']] as const) {
    await setup(page); await mockSync(page, mode); await sync(page)
    expect((await state(page)).sync[0].kind, mode).toBe(kind)
    expect((await sync(page)).attempted, mode).toBe(0)
    if (mode === 'auth' || mode === 'access') {
      await mockSync(page, 'accept'); await advanceAndSync(page, true)
      expect((await state(page)).sync[0].kind).toBe('ACCEPTED')
    }
    if (mode === 'network') {
      await page.reload(); expect((await state(page)).sync[0]).toMatchObject({ kind: 'RETRY_WAIT', attemptCount: 1 })
    }
  }
})

test('missing terminal result marker and orphan result fail closed without resending', async ({ page }) => {
  for (const target of ['result', 'sale']) {
    await setup(page); await mockSync(page, 'accept'); await sync(page)
    await page.evaluate(async target => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => { const tx = db.transaction(target === 'result' ? 'offlineSaleSync' : 'offlineSales', 'readwrite'); tx.objectStore(target === 'result' ? 'offlineSaleSync' : 'offlineSales').delete('sync-op'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
      db.close()
    }, target)
    await mockSync(page, 'accept')
    await expect(sync(page)).rejects.toThrow('OFFLINE_STATE_LOST')
    expect((await page.evaluate(() => (globalThis as any).__syncObserved)).calls).toBe(0)
  }
})

test('outcome-bound marker rejects plausible substitutions of every terminal kind without resending', async ({ page }) => {
  for (const [source, target] of [['accept', 'STOCK_CONFLICT'], ['accept', 'HARD_REJECTED'], ['conflict', 'ACCEPTED'], ['reject', 'ACCEPTED']] as const) {
    await setup(page); await mockSync(page, source); await sync(page)
    const original = await state(page)
    await page.evaluate(async target => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('offlineSaleSync', 'readwrite')
        const store = tx.objectStore('offlineSaleSync')
        const request = store.get('sync-op')
        request.onsuccess = () => {
          const record = request.result
          const replacement = target === 'STOCK_CONFLICT'
            ? { ...record, kind: target, lastMessage: 'VERIFIED_OFFLINE_STOCK_CONFLICT' } // Keep the accepted 201 and serverSaleId: the original review finding.
            : target === 'HARD_REJECTED'
              ? { ...record, kind: target, lastStatus: 409, lastMessage: 'IDEMPOTENCY_CONFLICT', serverSaleId: undefined }
              : { ...record, kind: target, lastStatus: 200, lastMessage: undefined, serverSaleId: 'sync-op', conflictIncidentIds: undefined }
          store.put(replacement, 'sync-op')
        }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
    }, target)
    const forged = await state(page)
    expect(forged.meta.terminalSyncOutcomes).toEqual(original.meta.terminalSyncOutcomes)
    await mockSync(page, 'accept')
    await expect(sync(page)).rejects.toThrow('OFFLINE_STATE_LOST')
    expect((await page.evaluate(() => (globalThis as any).__syncObserved)).calls).toBe(0)
    expect((await state(page)).sync[0].kind).toBe(target)
    expect((await state(page)).meta.terminalSyncOutcomes).toEqual(original.meta.terminalSyncOutcomes)
  }
})

test('missing, wrong-kind, and wrong-operation markers fail closed without reconstruction', async ({ page }) => {
  for (const mode of ['missing', 'wrong-kind', 'wrong-operation'] as const) {
    await setup(page); await mockSync(page, 'accept'); await sync(page)
    await page.evaluate(async mode => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('offlineMeta', 'readwrite')
        const store = tx.objectStore('offlineMeta')
        const request = store.get('state')
        request.onsuccess = () => store.put({ ...request.result, terminalSyncOutcomes: mode === 'missing' ? [] : [{ operationId: mode === 'wrong-operation' ? 'other-op' : 'sync-op', kind: mode === 'wrong-kind' ? 'STOCK_CONFLICT' : 'ACCEPTED' }] }, 'state')
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
    }, mode)
    await mockSync(page, 'accept')
    await expect(sync(page)).rejects.toThrow('OFFLINE_STATE_LOST')
    expect((await page.evaluate(() => (globalThis as any).__syncObserved)).calls).toBe(0)
  }
})

test('two tabs share one durable attempt and terminal result', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a); await mockSync(a, 'accept')
    const b = await context.newPage(); await b.goto('/'); await mockSync(b, 'accept')
    const attempts = await Promise.all([sync(a), sync(b)])
    expect(attempts.reduce((total, item) => total + item.attempted, 0)).toBe(1)
    expect((await state(a)).sync[0].kind).toBe('ACCEPTED')
    expect((await sync(b)).attempted).toBe(0)
  } finally { await context.close() }
})

test('two real tabs send concurrently; reverse-order exact accepted responses preserve one terminal result', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a); await delaySyncResponse(a)
    const b = await context.newPage(); await b.goto('/'); await delaySyncResponse(b)
    const first = sync(a)
    await expect.poll(() => a.evaluate(() => (globalThis as any).__delayedSyncCalls)).toBe(1)
    const second = advanceAndSync(b)
    await expect.poll(() => b.evaluate(() => (globalThis as any).__delayedSyncCalls)).toBe(1)
    await b.evaluate(() => (globalThis as any).__releaseSync('accepted', 200))
    expect(await second).toMatchObject({ attempted: 1 })
    expect((await state(a)).sync[0].kind).toBe('ACCEPTED')
    await a.evaluate(() => (globalThis as any).__releaseSync('accepted', 201))
    expect(await first).toMatchObject({ attempted: 1 })
    expect((await state(a)).meta.terminalSyncOutcomes).toEqual([{ operationId: 'sync-op', kind: 'ACCEPTED' }])
    expect((await state(b)).sync[0]).toMatchObject({ kind: 'ACCEPTED', lastStatus: 200 })
    expect((await sync(a)).attempted).toBe(0)
  } finally { await context.close() }
})

test('late incompatible response in two-tab race cannot overwrite accepted outcome or marker', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const a = await context.newPage(); await setup(a); await delaySyncResponse(a)
    const b = await context.newPage(); await b.goto('/'); await delaySyncResponse(b)
    const first = sync(a)
    await expect.poll(() => a.evaluate(() => (globalThis as any).__delayedSyncCalls)).toBe(1)
    const second = advanceAndSync(b)
    await expect.poll(() => b.evaluate(() => (globalThis as any).__delayedSyncCalls)).toBe(1)
    await b.evaluate(() => (globalThis as any).__releaseSync('accepted', 200))
    await second
    await a.evaluate(() => (globalThis as any).__releaseSync('conflict', 409))
    await expect(first).rejects.toThrow('OFFLINE_SYNC_TERMINAL_CONFLICT')
    expect((await state(a)).sync[0].kind).toBe('ACCEPTED')
    expect((await state(a)).meta.terminalSyncOutcomes).toEqual([{ operationId: 'sync-op', kind: 'ACCEPTED' }])
    expect((await sync(b)).attempted).toBe(0)
  } finally { await context.close() }
})

test('incompatible terminal response cannot overwrite a durable terminal result', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const prior = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('/offline-sales/sync')) return prior(url, options)
      const payload = JSON.parse(String(options?.body)); const envelope = payload.envelope
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['offlineSaleSync', 'identity', 'offlineMeta'], 'readwrite')
        const r = tx.objectStore('offlineSaleSync').get(envelope.offlineOperationId)
        r.onsuccess = () => {
          tx.objectStore('offlineSaleSync').put({ ...r.result, kind: 'STOCK_CONFLICT', lastStatus: 409, lastMessage: 'VERIFIED_OFFLINE_STOCK_CONFLICT', clientObservedAt: new Date().toISOString() }, envelope.offlineOperationId)
          const identity = tx.objectStore('identity').get('current'); identity.onsuccess = () => tx.objectStore('identity').put({ ...identity.result, offlineSyncEverTerminal: true }, 'current')
          const meta = tx.objectStore('offlineMeta').get('state'); meta.onsuccess = () => tx.objectStore('offlineMeta').put({ ...meta.result, terminalSyncOutcomes: [{ operationId: envelope.offlineOperationId, kind: 'STOCK_CONFLICT' }] }, 'state')
        }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
      return new Response(JSON.stringify({ sale: { id: envelope.proposedSaleId, location_id: envelope.locationId, status: 'completed', currency_code: envelope.currencyCode, currency_exponent: envelope.currencyExponent, subtotal_minor: envelope.subtotalMinor, payable_total_minor: envelope.payableTotalMinor }, items: envelope.lines.map((line: any) => ({ id: line.id, sale_id: envelope.proposedSaleId, product_id: line.productId, quantity: line.quantity, unit_price_minor: line.unitPriceMinor, line_total_minor: line.quantity * line.unitPriceMinor })), allocations: [{ id: envelope.cashAllocation.id, sale_id: envelope.proposedSaleId, method: 'cash', amount_minor: envelope.payableTotalMinor, ordinal: 0 }] }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }
  })
  await expect(sync(page)).rejects.toThrow('OFFLINE_SYNC_TERMINAL_CONFLICT')
  expect((await state(page)).sync[0].kind).toBe('STOCK_CONFLICT')
})

test('v3 to v4 preserves non-extractable key, Authority, permit, Sale and rejects stale v3 opener', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async name => {
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
    const upgraded = await import('/src/shared/offline/offlineRetailDatabase.ts').then(m => m.openOfflineRetailDatabase())
    const stores = Array.from(upgraded.objectStoreNames)
    const tx = upgraded.transaction(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales', 'offlineSaleSync'], 'readonly')
    const get = (store: string, key: IDBValidKey) => new Promise<any>((resolve, reject) => { const r = tx.objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const [identity, authorityAfter, permit, meta, saleAfter] = await Promise.all([get('identity', 'current'), get('offlineAuthorities', 'authority-1'), get('offlinePermits', ['authority-1', 0]), get('offlineMeta', 'state'), get('offlineSales', 'v3-op')])
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, identity.privateKey, new TextEncoder().encode('v4-preservation'))
    const verified = await crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, signature, new TextEncoder().encode('v4-preservation'))
    const version = upgraded.version; upgraded.close()
    const stale = await new Promise<string>(resolve => { const r = indexedDB.open(name, 3); r.onsuccess = () => { r.result.close(); resolve('OPENED') }; r.onerror = () => resolve(r.error?.name ?? 'ERROR') })
    return { version, stores, extractable: identity.privateKey.extractable, verified, authority: authorityAfter, permit, meta, sale: saleAfter, stale }
  }, dbName)
  expect(result).toMatchObject({ version: 4, stores: expect.arrayContaining(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales', 'offlineSaleSync']), extractable: false, verified: true, authority: { snapshot: { authorityId: 'authority-1' } }, permit: { localState: 'RESERVED', operationId: 'v3-op' }, meta: { saleOperationIds: ['v3-op'] }, sale: { state: 'PREPARED', envelope: { offlineOperationId: 'v3-op' } }, stale: 'VersionError' })
})
