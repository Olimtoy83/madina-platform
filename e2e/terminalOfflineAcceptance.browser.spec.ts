import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { acceptedEffects, conflictEffects, databaseWideConflictEffects, databaseWideEffects, withOfflineAcceptanceHarness, type OfflineAcceptanceHarness } from './offlineAcceptanceHarness'

const dbName = 'madina-crm:retail-offline-terminal-identity:v1'
type Committed = { state: 'COMMITTED_LOCAL'; envelope: { offlineOperationId: string; proposedSaleId: string }; payloadHash: string; signature: string }

async function scenario(browser: Browser, run: (harness: OfflineAcceptanceHarness, context: BrowserContext, page: Page) => Promise<void>) {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      await context.addCookies([{ name: 'madina-session', value: harness.sessionSecret, url: harness.url, sameSite: 'Lax' }])
      const page = await context.newPage()
      await page.goto(`${harness.url}/retail/offline-operations`)
      await expect(page.getByRole('heading', { name: 'Офлайн-операции' })).toBeVisible()
      await run(harness, context, page)
    } finally {
      await context.close()
    }
  })
}

async function provision(page: Page, harness: OfflineAcceptanceHarness) {
  const terminalId = await page.evaluate(async locationId => {
    const { beginTerminalEnrollment } = await import('/src/shared/offline/terminalProvisioning.ts')
    return (await beginTerminalEnrollment(locationId)).terminalId
  }, harness.locationId)
  if (!terminalId) throw new Error('Browser enrollment did not return a terminal ID.')
  const authority = await harness.offline.issueAuthority({ terminalId, userId: harness.userId, locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000), permitCount: 2, productIds: [harness.productId] }, harness.context)
  await page.evaluate(async ({ locationId, authorityId, userId }) => {
    const { installOfflineAuthority } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    await installOfflineAuthority(locationId, authorityId, userId)
  }, { locationId: harness.locationId, authorityId: authority.id, userId: harness.userId })
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDom } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { AuthProvider } = await import('/src/context/AuthProvider.tsx')
    const { useAuth } = await import('/src/context/useAuth.ts')
    const { useCommitOfflineSale } = await import('/src/shared/offline/offlineLocalSale.ts')
    function Probe() {
      ;(globalThis as any).__offlineAcceptanceCommit = useCommitOfflineSale()
      ;(globalThis as any).__offlineAcceptanceUser = useAuth().user?.id
      return null
    }
    const node = document.createElement('div')
    document.body.append(node)
    ReactDom.createRoot(node).render(React.createElement(AuthProvider, null, React.createElement(Probe)))
    await new Promise<void>((resolve, reject) => {
      let checks = 0
      const check = () => (globalThis as any).__offlineAcceptanceUser ? resolve() : ++checks > 100 ? reject(new Error('Browser AuthSession did not initialize.')) : setTimeout(check, 10)
      check()
    })
  })
  return authority
}

async function blockApi(context: BrowserContext) {
  const abort = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
  await context.route('**/api/**', abort)
  return () => context.unroute('**/api/**', abort)
}

async function commit(page: Page, harness: OfflineAcceptanceHarness, operationId: string): Promise<Committed> {
  return page.evaluate(async ({ authorityId, productId, operationId }) => {
    return (globalThis as any).__offlineAcceptanceCommit({ authorityId, operationId, lines: [{ productId, quantity: 2 }] })
  }, { authorityId: (harness as OfflineAcceptanceHarness & { authorityId: string }).authorityId, productId: harness.productId, operationId })
}

async function storedSale(page: Page, operationId: string): Promise<Committed> {
  return page.evaluate(async ({ name, operationId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<Committed>((resolve, reject) => {
        const request = db.transaction('offlineSales', 'readonly').objectStore('offlineSales').get(operationId)
        request.onsuccess = () => resolve(request.result as Committed)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  }, { name: dbName, operationId })
}

async function allStoredSales(page: Page) {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => request.transaction?.abort()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (!db.objectStoreNames.contains('offlineSales') || !db.objectStoreNames.contains('offlineSaleSync')) throw new Error('Offline Sale stores are missing.')
      return await new Promise<Array<{ operationId: string; proposedSaleId: string; localState: string; syncKind?: string; serverSaleId?: string }>>((resolve, reject) => {
        const tx = db.transaction(['offlineSales', 'offlineSaleSync'], 'readonly')
        const keys = tx.objectStore('offlineSales').getAllKeys()
        const sales = tx.objectStore('offlineSales').getAll()
        const sync = tx.objectStore('offlineSaleSync').getAll()
        tx.oncomplete = () => resolve(keys.result.map((key, index) => {
          const sale = sales.result[index] as Committed
          const result = (sync.result as Array<{ operationId: string; kind: string; serverSaleId?: string }>).find(item => item.operationId === key)
          return { operationId: String(key), proposedSaleId: sale.envelope.proposedSaleId, localState: sale.state, ...(result ? { syncKind: result.kind, ...(result.serverSaleId ? { serverSaleId: result.serverSaleId } : {}) } : {}) }
        }))
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, dbName)
}

async function storedRecovery(page: Page, operationId: string) {
  return page.evaluate(async ({ name, operationId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{ sync?: { kind: string; attemptCount: number; nextAttemptAt: number; clientObservedAt?: string; serverSaleId?: string }; marker: { terminalSyncOutcomes?: unknown[]; offlineSyncEverTerminal?: boolean } }>((resolve, reject) => {
        const tx = db.transaction(['offlineSaleSync', 'offlineMeta', 'identity'], 'readonly')
        const sync = tx.objectStore('offlineSaleSync').get(operationId)
        const meta = tx.objectStore('offlineMeta').get('state')
        const identity = tx.objectStore('identity').get('current')
        tx.oncomplete = () => resolve({ sync: sync.result, marker: { terminalSyncOutcomes: meta.result?.terminalSyncOutcomes, offlineSyncEverTerminal: identity.result?.offlineSyncEverTerminal } })
        tx.onerror = () => reject(tx.error)
      })
    } finally { db.close() }
  }, { name: dbName, operationId })
}

function stock(harness: OfflineAcceptanceHarness): number {
  return (harness.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(harness.productId, harness.locationId) as { on_hand_quantity: number }).on_hand_quantity
}

async function operation(page: Page, operationId: string) {
  return page.evaluate(async id => {
    const { readLocalOfflineOperations } = await import('/src/shared/offline/offlineOperationsProjection.ts')
    const result = await readLocalOfflineOperations()
    return result.state === 'ENROLLED' ? result.operations.find(item => item.operationId === id) : undefined
  }, operationId)
}

async function sync(page: Page, advance = false) {
  return page.evaluate(async advance => {
    const original = Date.now
    if (advance) Date.now = () => original() + 600_000
    try {
      const { syncPendingOfflineSales } = await import('/src/shared/offline/offlineSaleSync.ts')
      return await syncPendingOfflineSales()
    } finally {
      Date.now = original
    }
  }, advance)
}

async function refreshUi(page: Page) {
  await page.getByRole('button', { name: 'Обновить локальную диагностику' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Читаем локальную диагностику' })).toHaveCount(0)
}

test('A: real browser offline Sale survives reload and reaches real server and operator UI', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    const authority = await provision(page, harness)
    const offline = await blockApi(context)
    const operationId = 'acceptance-happy'
    const committed = await page.evaluate(async ({ authorityId, productId, operationId }) => {
      return (globalThis as any).__offlineAcceptanceCommit({ authorityId, operationId, lines: [{ productId, quantity: 2 }] }) as Promise<Committed>
    }, { authorityId: authority.id, productId: harness.productId, operationId })
    expect(committed.state).toBe('COMMITTED_LOCAL')
    expect(await storedSale(page, operationId)).toEqual(committed)
    expect(acceptedEffects(harness, operationId, committed.envelope.proposedSaleId).sales).toBe(0)
    await page.reload()
    expect(await storedSale(page, operationId)).toEqual(committed)
    await offline()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Офлайн-операции' })).toBeVisible()
    await expect.poll(async () => (await operation(page, operationId))?.state).toBe('ACCEPTED')
    expect(await storedSale(page, operationId)).toEqual(committed)
    expect(acceptedEffects(harness, operationId, committed.envelope.proposedSaleId)).toEqual({ sales: 1, lines: 1, allocations: 1, movements: 1, evidence: 1, receipts: 1, audits: 1 })
    await refreshUi(page)
    await expect(page.getByText('Принята — локально наблюдавшийся исход')).toBeVisible()
  })
})

test('B: committed server Sale survives a lost success response and exact production retry', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    const authority = await provision(page, harness)
    const offline = await blockApi(context)
    const operationId = 'acceptance-lost-response'
    const committed = await page.evaluate(async ({ authorityId, productId, operationId }) => {
      return (globalThis as any).__offlineAcceptanceCommit({ authorityId, operationId, lines: [{ productId, quantity: 2 }] }) as Promise<Committed>
    }, { authorityId: authority.id, productId: harness.productId, operationId })
    expect(committed.state).toBe('COMMITTED_LOCAL')
    const immutable = (sale: Committed) => ({ operationId: sale.envelope.offlineOperationId, proposedSaleId: sale.envelope.proposedSaleId, envelope: sale.envelope, payloadHash: sale.payloadHash, signature: sale.signature })
    const original = immutable(await storedSale(page, operationId))
    expect(original).toEqual(immutable(committed))
    expect(stock(harness)).toBe(10)
    const s0 = acceptedEffects(harness, operationId, original.proposedSaleId)
    const all0 = databaseWideEffects(harness)
    expect(s0).toEqual({ sales: 0, lines: 0, allocations: 0, movements: 0, evidence: 0, receipts: 0, audits: 0 })

    let firstDeliveryCount = 0
    let firstStatus: number | undefined
    let firstRequest: unknown
    let s1: ReturnType<typeof acceptedEffects> | undefined
    let all1: ReturnType<typeof databaseWideEffects> | undefined
    let firstStock: number | undefined
    const loseSuccess = async (route: import('@playwright/test').Route) => {
      firstDeliveryCount++
      firstRequest = route.request().postDataJSON()
      const response = await route.fetch()
      firstStatus = response.status()
      s1 = acceptedEffects(harness, operationId, original.proposedSaleId)
      all1 = databaseWideEffects(harness)
      firstStock = stock(harness)
      await route.abort('failed')
    }
    await context.route('**/offline-sales/sync', loseSuccess)
    await offline()
    expect((await sync(page)).attempted).toBe(1)
    await context.unroute('**/offline-sales/sync', loseSuccess)
    expect(firstDeliveryCount).toBe(1)
    expect(firstStatus).toBe(201)
    expect(firstRequest).toEqual({ envelope: original.envelope, payloadHash: original.payloadHash, signature: original.signature })
    expect(s1).toEqual({ sales: 1, lines: 1, allocations: 1, movements: 1, evidence: 1, receipts: 1, audits: 1 })
    expect(all1).toEqual({ sales: all0.sales + 1, lines: all0.lines + 1, allocations: all0.allocations + 1, movements: all0.movements + 1, evidence: all0.evidence + 1, receipts: all0.receipts + 1, audits: all0.audits + 1 })
    expect(firstStock).toBe(8)

    const ambiguous = await operation(page, operationId)
    expect(ambiguous).toMatchObject({ state: 'RETRY_WAIT', attemptCount: 1, result: 'NO_HTTP_RESULT' })
    expect(ambiguous?.nextAttemptAt).toBeGreaterThan(ambiguous?.lastAttemptAt ?? 0)
    expect(immutable(await storedSale(page, operationId))).toEqual(original)
    const afterLoss = await storedRecovery(page, operationId)
    expect(afterLoss.sync).toMatchObject({ kind: 'RETRY_WAIT', attemptCount: 1 })
    expect(afterLoss.sync?.clientObservedAt).toBeUndefined()
    expect(afterLoss.marker.terminalSyncOutcomes).toBeUndefined()
    expect(afterLoss.marker.offlineSyncEverTerminal).toBeUndefined()
    expect(immutable(await storedSale(page, operationId))).toEqual(original)

    const replayResponse = page.waitForResponse(response => response.url().includes('/offline-sales/sync') && response.request().method() === 'POST')
    expect((await sync(page, true)).attempted).toBe(1)
    const replay = await replayResponse
    expect(replay.status()).toBe(200)
    expect(replay.request().postDataJSON()).toEqual(firstRequest)
    expect((await replay.json() as { sale: { id: string } }).sale.id).toBe(original.proposedSaleId)
    expect(acceptedEffects(harness, operationId, original.proposedSaleId)).toEqual(s1)
    expect(databaseWideEffects(harness)).toEqual(all1)
    expect(stock(harness)).toBe(firstStock)
    expect(immutable(await storedSale(page, operationId))).toEqual(original)

    const final = await operation(page, operationId)
    expect(final).toMatchObject({ state: 'ACCEPTED', attemptCount: 2, lastHttpStatus: 200, result: 'EXACT_REPLAY' })
    const recovered = await storedRecovery(page, operationId)
    expect(recovered.sync).toMatchObject({ kind: 'ACCEPTED', attemptCount: 2, serverSaleId: original.proposedSaleId })
    expect(recovered.sync?.clientObservedAt).toBeTruthy()
    expect(recovered.marker.terminalSyncOutcomes).toEqual([{ operationId, kind: 'ACCEPTED' }])
    expect(recovered.marker.offlineSyncEverTerminal).toBe(true)
    await refreshUi(page)
    await expect(page.getByText('Принята — локально наблюдавшийся исход')).toBeVisible()
  })
})

test('C: real server stock depletion verifies conflict without accepting the offline Sale', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    const authority = await provision(page, harness)
    const offline = await blockApi(context)
    const operationId = 'acceptance-stock-conflict'
    const committed = await page.evaluate(async ({ authorityId, productId, operationId }) => {
      return (globalThis as any).__offlineAcceptanceCommit({ authorityId, operationId, lines: [{ productId, quantity: 2 }] }) as Promise<Committed>
    }, { authorityId: authority.id, productId: harness.productId, operationId })
    expect(committed.state).toBe('COMMITTED_LOCAL')
    const immutable = (sale: Committed) => ({ operationId: sale.envelope.offlineOperationId, proposedSaleId: sale.envelope.proposedSaleId, envelope: sale.envelope, payloadHash: sale.payloadHash, signature: sale.signature })
    const original = immutable(await storedSale(page, operationId))
    expect(original).toEqual(immutable(committed))
    expect(stock(harness)).toBe(10)

    await harness.inventory.recordMovement({ productId: harness.productId, locationId: harness.locationId, quantityDelta: -9, type: 'reconciliation_adjustment', sourceType: 'test', sourceId: 'offline-e2e-server-depletion', sourceLineId: 'adjustment' }, harness.context)
    expect(stock(harness)).toBe(1)
    expect(immutable(await storedSale(page, operationId))).toEqual(original)
    const c0 = databaseWideEffects(harness)
    const conflicts0 = databaseWideConflictEffects(harness)
    expect(c0).toMatchObject({ sales: 0, lines: 0, allocations: 0, movements: 2, evidence: 0, receipts: 0, audits: 0 })
    expect(conflicts0).toEqual({ verifications: 0, verificationLines: 0, incidents: 0 })

    const responsePromise = page.waitForResponse(response => response.url().includes('/offline-sales/sync') && response.request().method() === 'POST')
    await offline()
    expect((await sync(page)).attempted).toBe(1)
    const response = await responsePromise
    expect(response.status()).toBe(409)
    expect(await response.json()).toMatchObject({ statusCode: 409, error: 'Conflict', message: 'VERIFIED_OFFLINE_STOCK_CONFLICT' })
    expect(response.request().postDataJSON()).toEqual({ envelope: original.envelope, payloadHash: original.payloadHash, signature: original.signature })

    expect(databaseWideEffects(harness)).toEqual(c0)
    expect(stock(harness)).toBe(1)
    expect(databaseWideConflictEffects(harness)).toEqual({ verifications: 1, verificationLines: 1, incidents: 0 })
    const verification = harness.database.prepare('SELECT proposed_sale_id,payload_hash,signature FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id=?').get(operationId)
    expect(verification).toMatchObject({ proposed_sale_id: original.proposedSaleId, payload_hash: original.payloadHash, signature: original.signature })
    const verifiedLine = harness.database.prepare('SELECT product_id,quantity,observed_on_hand_quantity,initial_deficit_quantity FROM retail_offline_stock_conflict_verification_lines WHERE offline_operation_id=?').get(operationId)
    expect(verifiedLine).toMatchObject({ product_id: harness.productId, quantity: 2, observed_on_hand_quantity: 1, initial_deficit_quantity: 1 })
    expect(conflictEffects(harness, operationId, original.proposedSaleId)).toMatchObject({ accepted: { sales: 0, lines: 0, allocations: 0, movements: 0, evidence: 0, receipts: 0, audits: 0 }, verifications: 1 })

    const final = await operation(page, operationId)
    expect(final).toMatchObject({ state: 'STOCK_CONFLICT', attemptCount: 1, lastHttpStatus: 409, result: 'VERIFIED_STOCK_CONFLICT' })
    const recovered = await storedRecovery(page, operationId)
    expect(recovered.sync).toMatchObject({ kind: 'STOCK_CONFLICT', attemptCount: 1 })
    expect(recovered.sync?.serverSaleId).toBeUndefined()
    expect(recovered.sync?.clientObservedAt).toBeTruthy()
    expect(recovered.marker.terminalSyncOutcomes).toEqual([{ operationId, kind: 'STOCK_CONFLICT' }])
    expect(recovered.marker.offlineSyncEverTerminal).toBe(true)
    expect(immutable(await storedSale(page, operationId))).toEqual(original)
    await refreshUi(page)
    await expect(page.getByText('Конфликт остатков', { exact: true })).toBeVisible()
    await expect(page.getByText('Подтверждённый конфликт остатков')).toBeVisible()
    await expect(page.getByText('Следуйте действующему процессу разбора конфликта остатков.')).toBeVisible()
  })
})

test('J: two tabs race one persisted offline Sale into one real server materialization', async ({ browser }) => {
  await scenario(browser, async (harness, context, firstPage) => {
    const authority = await provision(firstPage, harness)
    const secondPage = await context.newPage()
    await secondPage.goto(`${harness.url}/retail/offline-operations`)
    await expect(secondPage.getByRole('heading', { name: 'Офлайн-операции' })).toBeVisible()
    const identity = async (page: Page) => page.evaluate(async () => {
      const { loadTerminalIdentity } = await import('/src/shared/offline/terminalIdentity.ts')
      const terminal = await loadTerminalIdentity()
      return terminal && { state: terminal.state, terminalId: terminal.terminalId, publicKey: terminal.publicKey, keyVersion: terminal.currentKeyVersion }
    })
    const firstIdentity = await identity(firstPage)
    expect(firstIdentity).toMatchObject({ state: 'ENROLLED' })
    expect(await identity(secondPage)).toEqual(firstIdentity)

    const offline = await blockApi(context)
    const operationId = 'acceptance-two-tab-race'
    const committed = await firstPage.evaluate(async ({ authorityId, productId, operationId }) => {
      return (globalThis as any).__offlineAcceptanceCommit({ authorityId, operationId, lines: [{ productId, quantity: 2 }] }) as Promise<Committed>
    }, { authorityId: authority.id, productId: harness.productId, operationId })
    expect(committed.state).toBe('COMMITTED_LOCAL')
    const immutable = (sale: Committed) => ({ operationId: sale.envelope.offlineOperationId, proposedSaleId: sale.envelope.proposedSaleId, envelope: sale.envelope, payloadHash: sale.payloadHash, signature: sale.signature })
    const original = immutable(await storedSale(firstPage, operationId))
    expect(original).toEqual(immutable(committed))
    expect(immutable(await storedSale(secondPage, operationId))).toEqual(original)
    const preFirst = await allStoredSales(firstPage)
    const preSecond = await allStoredSales(secondPage)
    expect(preFirst).toEqual([{ operationId, proposedSaleId: original.proposedSaleId, localState: 'COMMITTED_LOCAL' }])
    expect(preSecond).toEqual(preFirst)
    expect(stock(harness)).toBe(10)
    const j0 = databaseWideEffects(harness)
    expect(j0).toMatchObject({ sales: 0, lines: 0, allocations: 0, movements: 1, evidence: 0, receipts: 0, audits: 0 })

    type Delivery = { source: 'first' | 'second'; body: unknown }
    const deliveries: Delivery[] = []
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const hold = async (route: import('@playwright/test').Route) => {
      const source = route.request().frame().page() === firstPage ? 'first' : 'second'
      deliveries.push({ source, body: route.request().postDataJSON() })
      await barrier
      await route.continue()
    }
    await context.route('**/offline-sales/sync', hold)
    await offline()
    const firstResponse = firstPage.waitForResponse(response => response.url().includes('/offline-sales/sync') && response.request().method() === 'POST')
    const secondResponse = secondPage.waitForResponse(response => response.url().includes('/offline-sales/sync') && response.request().method() === 'POST')
    const firstAttempt = sync(firstPage)
    await expect.poll(() => deliveries.length).toBe(1)
    const secondAttempt = sync(secondPage, true)
    await expect.poll(() => deliveries.length).toBe(2)
    expect(deliveries.map(item => item.source).sort()).toEqual(['first', 'second'])
    for (const delivery of deliveries) expect(delivery.body).toEqual({ envelope: original.envelope, payloadHash: original.payloadHash, signature: original.signature })
    release()
    const [firstHttp, secondHttp, firstResult, secondResult] = await Promise.all([firstResponse, secondResponse, firstAttempt, secondAttempt])
    await context.unroute('**/offline-sales/sync', hold)
    expect([firstHttp.status(), secondHttp.status()].sort()).toEqual([200, 201])
    expect(firstResult.attempted).toBe(1)
    expect(secondResult.attempted).toBe(1)
    expect((await firstHttp.json() as { sale: { id: string } }).sale.id).toBe(original.proposedSaleId)
    expect((await secondHttp.json() as { sale: { id: string } }).sale.id).toBe(original.proposedSaleId)

    expect(databaseWideEffects(harness)).toEqual({ sales: j0.sales + 1, lines: j0.lines + 1, allocations: j0.allocations + 1, movements: j0.movements + 1, evidence: j0.evidence + 1, receipts: j0.receipts + 1, audits: j0.audits + 1 })
    expect(stock(harness)).toBe(8)
    expect(acceptedEffects(harness, operationId, original.proposedSaleId)).toEqual({ sales: 1, lines: 1, allocations: 1, movements: 1, evidence: 1, receipts: 1, audits: 1 })
    for (const page of [firstPage, secondPage]) {
      expect(immutable(await storedSale(page, operationId))).toEqual(original)
      expect(await allStoredSales(page)).toEqual([{ operationId, proposedSaleId: original.proposedSaleId, localState: 'COMMITTED_LOCAL', syncKind: 'ACCEPTED', serverSaleId: original.proposedSaleId }])
      expect(await operation(page, operationId)).toMatchObject({ state: 'ACCEPTED', attemptCount: 2 })
      const recovered = await storedRecovery(page, operationId)
      expect(recovered.sync).toMatchObject({ kind: 'ACCEPTED', attemptCount: 2, serverSaleId: original.proposedSaleId })
      expect(recovered.marker.terminalSyncOutcomes).toEqual([{ operationId, kind: 'ACCEPTED' }])
      expect(recovered.marker.offlineSyncEverTerminal).toBe(true)
      const projection = await page.evaluate(async () => {
        const { readLocalOfflineOperations } = await import('/src/shared/offline/offlineOperationsProjection.ts')
        return await readLocalOfflineOperations()
      })
      expect(projection.state).toBe('ENROLLED')
      if (projection.state === 'ENROLLED') {
        expect(projection.operations).toHaveLength(1)
        expect(projection.operations.map(item => item.operationId)).toEqual([operationId])
        expect(projection.operations.filter(item => item.operationId === operationId)).toHaveLength(1)
      }
    }
    await refreshUi(firstPage)
    await expect(firstPage.getByText('Принята — локально наблюдавшийся исход')).toBeVisible()
  })
})
