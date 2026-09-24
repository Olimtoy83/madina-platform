import { expect, test, type Page } from '@playwright/test'

const dbName = 'madina-crm:retail-offline-terminal-identity:v1'
const route = '/retail/offline-operations'

async function visit(page: Page, role: 'admin' | 'manager' | 'operator' | 'viewer' = 'manager') {
  await page.addInitScript(role => {
    ;(globalThis as any).__testOnline = false
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => (globalThis as any).__testOnline })
    const authority = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 125 }], permits: [{ permitId: 'permit-0', sequence: 0, status: 'AVAILABLE' }], permitCounts: { available: 1, conflictPending: 0, accepted: 0 } }
    globalThis.fetch = async url => {
      const path = String(url)
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
      if (path.endsWith('/auth/me')) return json({ user: { id: 'user-1', username: 'user-1', role } })
      if (path.endsWith('/api/v1/commerce/products')) return json({ products: [] })
      if (path.endsWith('/api/v1/clients')) return json({ clients: [] })
      if (path.endsWith('/api/v1/tasks')) return json({ tasks: [] })
      if (path.endsWith('/import')) return json({ imported: true, idempotent: false, created: 0, updated: 0 })
      if (path.includes('/offline-terminals')) return json({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } })
      return json(path.endsWith('/permits') ? { permits: authority.permits } : { authority })
    }
  }, role)
  await page.goto(route)
}

async function refresh(page: Page) {
  await page.getByRole('button', { name: 'Обновить локальную диагностику' }).click()
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Читаем локальную диагностику' })).toHaveCount(0)
}

async function installLocalTerminal(page: Page) {
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
}

async function commit(page: Page, operationId = 'ui-op') {
  await page.evaluate(operationId => (globalThis as any).__commitSale({ authorityId: 'authority-1', operationId, lines: [{ productId: 'product-1', quantity: 1 }] }), operationId)
}

async function syncAs(page: Page, outcome: 'accepted' | 'replay' | 'retry' | 'auth' | 'access' | 'review' | 'conflict' | 'rejected') {
  await page.evaluate(outcome => {
    ;(globalThis as any).__testOnline = true
    ;(globalThis as any).__syncCalls = 0
    const prior = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('/offline-sales/sync')) return prior(url, options)
      ;(globalThis as any).__syncCalls++
      const envelope = JSON.parse(String(options?.body)).envelope
      const error = (status: number, message: string) => new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } })
      if (outcome === 'retry') return error(520, 'secret upstream diagnostic')
      if (outcome === 'auth') return error(401, 'secret session diagnostic')
      if (outcome === 'access') return error(403, 'secret access diagnostic')
      if (outcome === 'review') return error(409, 'RETAIL_OFFLINE_REVIEW_REQUIRED')
      if (outcome === 'conflict') return error(409, 'VERIFIED_OFFLINE_STOCK_CONFLICT')
      if (outcome === 'rejected') return error(409, 'IDEMPOTENCY_CONFLICT')
      return new Response(JSON.stringify({
        sale: { id: envelope.proposedSaleId, location_id: envelope.locationId, status: 'completed', currency_code: envelope.currencyCode, currency_exponent: envelope.currencyExponent, subtotal_minor: envelope.subtotalMinor, payable_total_minor: envelope.payableTotalMinor },
        items: envelope.lines.map((line: any) => ({ id: line.id, sale_id: envelope.proposedSaleId, product_id: line.productId, quantity: line.quantity, unit_price_minor: line.unitPriceMinor, line_total_minor: line.quantity * line.unitPriceMinor })),
        allocations: [{ id: envelope.cashAllocation.id, sale_id: envelope.proposedSaleId, method: 'cash', amount_minor: envelope.payableTotalMinor, ordinal: 0 }],
      }), { status: outcome === 'replay' ? 200 : 201, headers: { 'Content-Type': 'application/json' } })
    }
  }, outcome)
  await page.evaluate(() => import('/src/shared/offline/offlineSaleSync.ts').then(m => m.syncPendingOfflineSales()))
  await page.evaluate(() => { (globalThis as any).__testOnline = false })
}

async function stored(page: Page) {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const stores = ['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales', 'offlineSaleSync']
    const tx = db.transaction(stores, 'readonly')
    const values = await Promise.all(stores.map(store => new Promise<unknown[]>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
    db.close()
    return values
  }, dbName)
}

async function validLegacyV3(page: Page) {
  await page.evaluate(async name => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))))
    const authority = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, productPrices: [{ productId: 'product-1', unitPriceMinor: 125 }] }
    const envelope = { schemaVersion: 1, offlineOperationId: 'v3-op', authorityId: 'authority-1', authorityVersion: 1, permitId: 'permit-0', permitSequence: 0, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', proposedSaleId: 'v3-op', lines: [{ id: 'v3-line', productId: 'product-1', quantity: 1, unitPriceMinor: 125 }], currencyCode: 'USD', currencyExponent: 2, cashAllocation: { id: 'v3-payment', method: 'cash', amountMinor: 125, ordinal: 0 }, subtotalMinor: 125, payableTotalMinor: 125, claimedOfflineCompletedAt: new Date().toISOString() }
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 3); r.onupgradeneeded = () => { for (const store of ['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales']) r.result.createObjectStore(store) }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['identity', 'offlineAuthorities', 'offlinePermits', 'offlineMeta', 'offlineSales'], 'readwrite')
      tx.objectStore('identity').put({ version: 1, publicKeyAlgorithm: 'ed25519-spki-der-base64-v1', privateKey: pair.privateKey, publicKey, terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, offlineStateEverInstalled: true, offlineSaleEverPrepared: true }, 'current')
      tx.objectStore('offlineAuthorities').put({ snapshot: authority, knownRevoked: false }, 'authority-1')
      tx.objectStore('offlinePermits').put({ authorityId: 'authority-1', permitId: 'permit-0', sequence: 0, serverStatus: 'AVAILABLE', localState: 'RESERVED', operationId: 'v3-op' }, ['authority-1', 0])
      tx.objectStore('offlineMeta').put({ version: 1, terminalId: 'terminal-1', locationId: 'location-1', authorityIds: ['authority-1'], saleOperationIds: ['v3-op'], lastObservedMs: Date.now(), knownTerminalUnsafe: false }, 'state')
      tx.objectStore('offlineSales').put({ state: 'PREPARED', intent: { authorityId: 'authority-1', lines: [{ productId: 'product-1', quantity: 1 }] }, envelope, publicKey, authoritySnapshot: authority }, 'v3-op')
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, dbName)
}

for (const role of ['admin', 'manager', 'operator', 'viewer'] as const) {
  test(`direct route and sidebar enforce ${role} access`, async ({ page }) => {
    await visit(page, role)
    if (role === 'admin' || role === 'manager') {
      await expect(page).toHaveURL(new RegExp(`${route}$`))
      await expect(page.getByRole('heading', { name: 'Офлайн-операции' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Офлайн-операции' })).toBeVisible()
      await expect(page.locator('.app-header')).toContainText('Офлайн-операции')
    } else {
      await expect(page).toHaveURL('http://127.0.0.1:4174/')
      await expect(page.getByRole('link', { name: 'Офлайн-операции' })).toHaveCount(0)
    }
  })
}

test('uninitialized profile stays local and refresh does not create a database', async ({ page }) => {
  await visit(page)
  await expect(page.getByText('Локальное офлайн-состояние не установлено')).toBeVisible()
  await expect(page.getByText('Это не обзор всех терминалов', { exact: false })).toBeVisible()
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)), dbName)).toBeUndefined()
  await refresh(page)
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)), dbName)).toBeUndefined()
})

test('local installation appears only after manual diagnostic refresh', async ({ page }) => {
  await visit(page)
  await expect(page.getByText('Локальное офлайн-состояние не установлено')).toBeVisible()
  await page.evaluate(() => import('/src/shared/offline/terminalIdentity.ts').then(m => m.generateTerminalIdentity()))
  await refresh(page)
  await expect(page.getByText('Терминал ещё не зарегистрирован')).toBeVisible()
})

test('enrolled empty state and first delivery stay local and unchanged by refresh', async ({ page }) => {
  await visit(page)
  await installLocalTerminal(page)
  await refresh(page)
  await expect(page.getByText('Локальных операций пока нет')).toBeVisible()
  await expect(page.getByText('terminal-1')).toBeVisible()
  await expect(page.getByText('location-1')).toBeVisible()
  await commit(page)
  await refresh(page)
  await expect(page.getByText('Ожидает первой отправки', { exact: true })).toBeVisible()
  await expect(page.locator('.offline-operations__operation h3')).toContainText('ui-op')
  await expect(page.getByText('Отправка не предпринималась')).toBeVisible()
  await expect(page.getByText('secret upstream diagnostic')).toHaveCount(0)
})

test('supported legacy schema is not shown as data loss and is not upgraded', async ({ page }) => {
  await visit(page)
  await validLegacyV3(page)
  await refresh(page)
  await expect(page.getByText('Поддерживаемая прежняя схема')).toBeVisible()
  await expect(page.getByText('схема версии 3', { exact: false })).toBeVisible()
  await expect(page.getByText('не означает потерю данных', { exact: false })).toBeVisible()
  await expect(page.getByText('Требуют внимания')).toHaveCount(0)
  expect(await page.evaluate(name => indexedDB.databases().then(items => items.find(item => item.name === name)?.version), dbName)).toBe(3)
})

test('prepared Sale is not described as committed or delivery-pending', async ({ page }) => {
  await visit(page)
  await installLocalTerminal(page)
  await page.evaluate(async () => {
    const original = SubtleCrypto.prototype.sign
    SubtleCrypto.prototype.sign = function (algorithm, key, data) {
      if (new TextDecoder().decode(data).startsWith('madina-retail-offline-terminal-keypair-consistency-v1')) return original.call(this, algorithm, key, data)
      throw new Error('stop after prepare')
    }
    try { await (globalThis as any).__commitSale({ authorityId: 'authority-1', operationId: 'prepared-ui-op', lines: [{ productId: 'product-1', quantity: 1 }] }).catch(() => undefined) }
    finally { SubtleCrypto.prototype.sign = original }
  })
  await refresh(page)
  await expect(page.getByText('Подготовлена локально', { exact: true })).toBeVisible()
  await expect(page.getByText('Не завершена локально', { exact: true })).toBeVisible()
  await expect(page.getByText('Не создавайте продажу-дубликат', { exact: false })).toBeVisible()
  await expect(page.getByText('Завершена локально', { exact: true })).toHaveCount(0)
})

for (const [outcome, label, guidance] of [
  ['retry', 'Ожидает автоматической попытки', 'Автоматическая попытка запланирована'],
  ['auth', 'Нужна авторизация', 'Восстановите авторизованную сессию'],
  ['access', 'Нет доступа', 'Проверьте доступ пользователя'],
  ['review', 'Требуется проверка', 'Разберитесь в причине удержания'],
  ['accepted', 'Принята — локально наблюдавшийся исход', 'Принятие было записано этим браузером'],
  ['conflict', 'Конфликт остатков', 'Следуйте действующему процессу'],
  ['rejected', 'Отклонена', 'Передайте ответственному ID операции'],
] as const) {
  test(`real ${outcome} outcome has bounded operator guidance`, async ({ page }) => {
    await visit(page)
    await installLocalTerminal(page)
    await commit(page)
    await syncAs(page, outcome)
    if (outcome === 'auth') await page.reload()
    await refresh(page)
    await expect(page.locator('.offline-operations__operation .mb-badge')).toHaveText(label)
    await expect(page.getByText(guidance, { exact: false })).toBeVisible()
    if (outcome === 'retry') await expect(page.getByText('Следующая плановая попытка')).toBeVisible()
    if (outcome === 'accepted') await expect(page.getByText('Последнее локально наблюдавшееся принятие', { exact: false })).toBeVisible()
    await expect(page.getByText('secret upstream diagnostic')).toHaveCount(0)
    await expect(page.getByText('secret session diagnostic')).toHaveCount(0)
    await expect(page.getByText('secret access diagnostic')).toHaveCount(0)
  })
}

test('refresh is observational and never resends accepted evidence', async ({ page }) => {
  await visit(page)
  await installLocalTerminal(page)
  await commit(page)
  await syncAs(page, 'accepted')
  await refresh(page)
  const before = await stored(page)
  const calls = await page.evaluate(() => (globalThis as any).__syncCalls)
  await refresh(page)
  expect(await stored(page)).toEqual(before)
  expect(await page.evaluate(() => (globalThis as any).__syncCalls)).toBe(calls)
  const evidence = before[4][0] as { canonicalPayload: string; payloadHash: string; signature: string; envelope: unknown }
  const text = await page.locator('.offline-operations').innerText()
  for (const secret of [evidence.canonicalPayload, evidence.payloadHash, evidence.signature, JSON.stringify(evidence.envelope), 'privateKey', 'lastMessage']) expect(text).not.toContain(secret)
  await expect(page.getByRole('button', { name: 'Обновить локальную диагностику' })).toBeVisible()
})

test('integrity failure blocks counts and operations without repair actions', async ({ page }) => {
  await visit(page)
  await installLocalTerminal(page)
  await commit(page)
  await syncAs(page, 'accepted')
  await refresh(page)
  await expect(page.locator('.offline-operations__operation h3')).toContainText('ui-op')
  await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('offlineMeta', 'readwrite'); const r = tx.objectStore('offlineMeta').get('state'); r.onsuccess = () => tx.objectStore('offlineMeta').put({ ...r.result, terminalSyncOutcomes: [] }, 'state'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  }, dbName)
  await refresh(page)
  await expect(page.getByText('Целостность или доступность локального офлайн-состояния не подтверждена', { exact: false })).toBeVisible()
  await expect(page.locator('.offline-operations__operation')).toHaveCount(0)
  await expect(page.getByText('Требуют внимания')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /удалить|исправить|повторить|сбросить|принять/i })).toHaveCount(0)
})

test('320px page keeps long IDs and refresh usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await visit(page)
  await installLocalTerminal(page)
  const operationId = `mobile-${'x'.repeat(120)}`
  await commit(page, operationId)
  await refresh(page)
  await expect(page.locator('.offline-operations__operation h3')).toContainText(operationId)
  await expect(page.getByRole('button', { name: 'Обновить локальную диагностику' })).toBeVisible()
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
