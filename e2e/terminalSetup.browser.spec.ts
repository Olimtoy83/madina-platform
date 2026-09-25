import { expect, test, type Page } from '@playwright/test'

type Role = 'admin' | 'manager' | 'operator' | 'viewer'
type SetupState = { role: Role; authorities: Array<Record<string, any>>; terminalRevoked: boolean; terminalVersion: number; locationStatus: number; discoveryFailure: boolean; malformedDiscovery: boolean; issueStatus: number; posts: Array<{ path: string; body: any }>; holds: string[]; enteredReads: string[]; completedReads: string[]; releases: Record<string, () => void> }
declare global { interface Window { __setup: SetupState } }

async function visit(page: Page, role: Role = 'manager') {
  await page.addInitScript(role => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const state: SetupState = { role, authorities: JSON.parse(sessionStorage.getItem('terminal-setup-authorities') ?? '[]'), terminalRevoked: false, terminalVersion: 1, locationStatus: 200, discoveryFailure: false, malformedDiscovery: false, issueStatus: 201, posts: [], holds: [], enteredReads: [], completedReads: [], releases: {} }
    window.__setup = state
    const original = globalThis.fetch.bind(globalThis)
    const now = new Date().toISOString()
    const location = { id: 'location-1', name: 'Магазин', type: 'store', status: 'active', currencyCode: 'USD', currencyExponent: 2, createdAt: now, updatedAt: now }
    const otherLocation = { ...location, id: 'location-2', name: 'Магазин Б' }
    const product = { id: 'product-1', sourceId: 'source-1', name: 'Товар', status: 'active', baseUnit: 'piece', createdAt: now, updatedAt: now }
    globalThis.fetch = async (input, options) => {
      const path = String(input), method = options?.method ?? 'GET'
      if (!path.startsWith('/api/')) return original(input, options)
      const body = options?.body ? JSON.parse(String(options.body)) : undefined
      if (method === 'POST') state.posts.push({ path, body })
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
      if (path.endsWith('/auth/me')) return json({ user: { id: 'user-1', username: 'user-1', role: state.role } })
      if (path.endsWith('/api/v1/commerce/products')) return json({ products: [] })
      if (path.endsWith('/api/v1/clients')) return json({ clients: [] })
      if (path.endsWith('/api/v1/tasks')) return json({ tasks: [] })
      if (path.endsWith('/import')) return json({ imported: true, idempotent: false, created: 0, updated: 0 })
      if (path.endsWith('/api/v1/retail/locations')) return json({ locations: [location, otherLocation] })
      if (path.endsWith('/api/v1/retail/locations/location-1') || path.endsWith('/api/v1/retail/locations/location-2')) {
        const selected = path.endsWith('location-1') ? location : otherLocation
        if (state.holds.includes(selected.id)) {
          state.enteredReads.push(selected.id)
          await new Promise<void>(resolve => { state.releases[selected.id] = resolve })
        }
        state.completedReads.push(selected.id)
        return selected.id === 'location-1' && state.locationStatus !== 200 ? json({ message: 'secret grant diagnostic' }, state.locationStatus) : json({ location: selected })
      }
      if (path.includes('/products/') && path.endsWith('/price')) return json({ unitPriceMinor: 100 })
      if (path.startsWith('/api/v1/retail/products?')) return json({ products: [product] })
      if (path.endsWith('/offline-terminals') && method === 'POST') return json({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }, 201)
      if (path.endsWith('/offline-terminals/terminal-1')) return json({ terminal: { terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: state.terminalVersion, revoked: state.terminalRevoked } })
      if (path.endsWith('/offline-authorities') && method === 'POST') {
        if (state.issueStatus !== 201) return json({ message: 'secret server error' }, state.issueStatus)
        const issuedAt = new Date().toISOString()
        const authority = { authorityId: `authority-${state.authorities.length + 1}`, authorityVersion: 1, terminalId: body.terminalId, terminalKeyVersion: 1, userId: body.userId, locationId: 'location-1', issuedAt, expiresAt: body.expiresAt, currencyCode: 'USD', currencyExponent: 2, permitCount: body.permitCount, revoked: false, productPrices: body.productIds.map((productId: string) => ({ productId, unitPriceMinor: 100 })), permits: Array.from({ length: body.permitCount }, (_: unknown, sequence: number) => ({ permitId: `permit-${state.authorities.length + 1}-${sequence}`, sequence, status: 'AVAILABLE' })), permitCounts: { available: body.permitCount, conflictPending: 0, accepted: 0 } }
        state.authorities.push(authority)
        sessionStorage.setItem('terminal-setup-authorities', JSON.stringify(state.authorities))
        return json({ authority: { ...authority, id: authority.authorityId } }, 201)
      }
      if (path.endsWith('/offline-authorities')) {
        if (state.discoveryFailure) return json({ message: 'secret server error' }, 503)
        if (state.malformedDiscovery) return json({ authorities: [{ authorityId: 'broken' }] })
        return json({ authorities: state.authorities.map(({ productPrices: _prices, permits: _permits, permitCounts: _counts, ...summary }) => summary) })
      }
      const match = path.match(/\/offline-authorities\/([^/]+)(?:\/(permits))?$/)
      if (match) {
        const found = state.authorities.find(item => item.authorityId === decodeURIComponent(match[1]!))
        if (!found) return json({ message: 'Not found' }, 404)
        return json(match[2] ? { permits: found.permits } : { authority: found })
      }
      return json({ message: 'Not found' }, 404)
    }
  }, role)
  await page.goto('/retail/terminal-setup')
}

async function choose(page: Page) {
  await page.getByLabel('Торговая точка').selectOption('location-1')
  await expect(page.getByText('Этот браузер ещё не зарегистрирован')).toBeVisible()
}

async function register(page: Page) {
  await page.getByRole('button', { name: 'Зарегистрировать этот браузер' }).click()
  await expect(page.getByText('Локальная Authority ещё не установлена')).toBeVisible()
}

async function fillIssue(page: Page) {
  const future = new Date(Date.now() + 3_600_000)
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  await page.getByLabel('Срок действия').fill(local)
  await page.getByLabel('Число офлайн-разрешений').fill('2')
  await page.getByLabel('Товар из каталога').fill('Товар')
  await page.getByRole('button', { name: 'Найти товары' }).click()
  await page.getByRole('button', { name: 'Добавить' }).click()
}

for (const role of ['admin', 'manager', 'operator', 'viewer'] as const) {
  test(`setup route and navigation enforce ${role} capability`, async ({ page }) => {
    await visit(page, role)
    if (role === 'admin' || role === 'manager') {
      await expect(page.getByRole('heading', { name: 'Подготовка терминала' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Подготовка терминала' })).toBeVisible()
    } else {
      await expect(page).toHaveURL('http://127.0.0.1:4174/')
      await expect(page.getByRole('link', { name: 'Подготовка терминала' })).toHaveCount(0)
    }
  })
}

test('clean profile: observational mount, explicit registration, issuance, installation and READY after reload', async ({ page }) => {
  await visit(page)
  await choose(page)
  expect(await page.evaluate(() => indexedDB.databases().then(items => items.some(item => item.name === 'madina-crm:retail-offline-terminal-identity:v1')))).toBe(false)
  expect(await page.evaluate(() => window.__setup.posts)).toEqual([])
  await register(page)
  await expect(page.getByText('Совместимая существующая Authority не найдена', { exact: false })).toBeVisible()
  await fillIssue(page)
  await page.getByRole('button', { name: 'Начать выпуск Authority' }).click()
  await expect(page.getByText('Выпуск подтверждён, но Authority ещё не установлена')).toBeVisible()
  await expect(page.getByText('Готов сейчас')).toHaveCount(0)
  await page.getByRole('button', { name: 'Установить Authority authority-1' }).click()
  await expect(page.getByText('Готов сейчас')).toBeVisible()
  expect(await page.evaluate(() => window.__setup.posts.filter(item => item.path.endsWith('/offline-authorities')).length)).toBe(1)
  const beforeReload = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts').then(module => module.loadTerminalIdentity())
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const count = await new Promise<number>((resolve, reject) => { const tx = db.transaction('offlineAuthorities', 'readonly'); const request = tx.objectStore('offlineAuthorities').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    db.close()
    return { terminalId: identity?.terminalId, keyVersion: identity?.currentKeyVersion, publicKey: identity?.publicKey, localAuthorities: count, serverAuthorities: window.__setup.authorities.length }
  })
  await page.reload()
  await page.getByLabel('Торговая точка').selectOption('location-1')
  await expect(page.getByText('Готов сейчас')).toBeVisible()
  const afterReload = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts').then(module => module.loadTerminalIdentity())
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const count = await new Promise<number>((resolve, reject) => { const tx = db.transaction('offlineAuthorities', 'readonly'); const request = tx.objectStore('offlineAuthorities').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    db.close()
    return { terminalId: identity?.terminalId, keyVersion: identity?.currentKeyVersion, publicKey: identity?.publicKey, localAuthorities: count, serverAuthorities: window.__setup.authorities.length }
  })
  expect(beforeReload).toMatchObject({ terminalId: 'terminal-1', keyVersion: 1, localAuthorities: 1, serverAuthorities: 1 })
  expect(afterReload).toEqual(beforeReload)
  expect(await page.evaluate(() => window.__setup.posts.filter(item => item.path.endsWith('/offline-terminals') || item.path.endsWith('/offline-authorities')))).toEqual([])
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Установить Authority/ })).toHaveCount(0)
})

test('existing compatible choices require selection; discovery failure never unlocks issuance', async ({ page }) => {
  await visit(page)
  await choose(page)
  await register(page)
  await page.evaluate(() => {
    const make = (id: string) => ({ authorityId: id, authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }], permits: [{ permitId: `permit-${id}`, sequence: 0, status: 'AVAILABLE' }], permitCounts: { available: 1, conflictPending: 0, accepted: 0 } })
    window.__setup.authorities = [make('authority-a'), make('authority-b')]
  })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByText(/ID authority-a; срок/)).toBeVisible()
  await expect(page.getByText(/ID authority-b; срок/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Установить Authority/ })).toHaveCount(0)
  await page.getByLabel(/ID authority-b; срок/).check()
  await page.getByRole('button', { name: 'Установить Authority authority-b' }).click()
  await expect(page.getByText('Готов сейчас')).toBeVisible()
  expect(await page.evaluate(() => window.__setup.posts.filter(item => item.path.endsWith('/offline-authorities')).length)).toBe(0)
})

test('pending command survives reload and REVIEW_HOLD blocks discovery and new issuance', async ({ page }) => {
  await visit(page)
  await choose(page)
  await register(page)
  await fillIssue(page)
  await page.evaluate(() => { window.__setup.issueStatus = 503 })
  await page.getByRole('button', { name: 'Начать выпуск Authority' }).click()
  await expect(page.getByText('Команда сохранена; исход требует восстановления')).toBeVisible()
  const first = await page.evaluate(() => window.__setup.posts.find(item => item.path.endsWith('/offline-authorities'))?.body.commandId)
  expect(typeof first).toBe('string')
  expect(first.length).toBeGreaterThan(0)
  await page.reload()
  await page.getByLabel('Торговая точка').selectOption('location-1')
  await expect(page.getByRole('button', { name: 'Возобновить ту же команду' })).toBeVisible()
  await expect(page.getByText('Существующая Authority')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await page.evaluate(() => { window.__setup.issueStatus = 400 })
  await page.getByRole('button', { name: 'Возобновить ту же команду' }).click()
  await expect(page.getByText('Требуется проверка администратором', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Возобновить ту же команду' })).toHaveCount(0)
  await expect(page.getByText('Существующая Authority')).toHaveCount(0)
  const replay = await page.evaluate(() => window.__setup.posts.find(item => item.path.endsWith('/offline-authorities'))?.body.commandId)
  expect(replay).toBe(first)
  expect(await page.evaluate(() => window.__setup.posts.filter(item => item.path.endsWith('/offline-authorities')).length)).toBe(1)
})

test('unavailable discovery blocks new issuance; revoked terminal has no reset path', async ({ page }) => {
  await visit(page)
  await choose(page)
  await register(page)
  await page.evaluate(() => { window.__setup.discoveryFailure = true })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByText('Новый выпуск заблокирован.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await page.evaluate(() => { window.__setup.discoveryFailure = false; window.__setup.terminalRevoked = true })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByText('Терминал отозван')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Зарегистрировать этот браузер' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Установить Authority/ })).toHaveCount(0)
})

test('one existing Authority is offered for explicit install; malformed discovery blocks issue', async ({ page }) => {
  await visit(page)
  await choose(page)
  await register(page)
  await page.evaluate(() => {
    window.__setup.authorities = [{ authorityId: 'authority-existing', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }], permits: [{ permitId: 'permit-existing', sequence: 0, status: 'AVAILABLE' }], permitCounts: { available: 1, conflictPending: 0, accepted: 0 } }]
    window.__setup.malformedDiscovery = true
  })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByText('Ответ сервера не удалось проверить', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await page.evaluate(() => { window.__setup.malformedDiscovery = false })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByRole('button', { name: 'Установить Authority authority-existing' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Установить Authority authority-existing' }).click()
  await expect(page.getByText('Готов сейчас')).toBeVisible()
})

test('denied location never mutates profile; damaged identity has no reset action or secret output', async ({ page }) => {
  await visit(page)
  await page.evaluate(() => { window.__setup.locationStatus = 403 })
  await page.getByLabel('Торговая точка').selectOption('location-1')
  await expect(page.getByText('Нет доступа к торговой точке')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Зарегистрировать этот браузер' })).toHaveCount(0)
  expect(await page.evaluate(() => indexedDB.databases().then(items => items.some(item => item.name === 'madina-crm:retail-offline-terminal-identity:v1')))).toBe(false)
  expect(await page.evaluate(() => window.__setup.posts)).toEqual([])
  await expect(page.getByText('secret grant diagnostic')).toHaveCount(0)
  await page.evaluate(() => { window.__setup.locationStatus = 200 })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await register(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('identity', 'readwrite'); const store = tx.objectStore('identity'); const request = store.get('current'); request.onsuccess = () => store.put({ ...request.result, publicKey: 'corrupt' }, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByText('Целостность локального состояния не подтверждена')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Зарегистрировать этот браузер' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  await expect(page.getByText('secret server error')).toHaveCount(0)
})

test('switching between two stores clears A actions immediately and rejects its delayed read after B is selected', async ({ page }) => {
  await visit(page)
  await choose(page)
  await register(page)
  await page.evaluate(() => {
    window.__setup.authorities = [{ authorityId: 'authority-a1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 1, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }], permits: [{ permitId: 'permit-a1', sequence: 0, status: 'AVAILABLE' }], permitCounts: { available: 1, conflictPending: 0, accepted: 0 } }]
  })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByRole('button', { name: 'Установить Authority authority-a1' })).toBeVisible()

  // Inspect the same browser task immediately after React commits the select event, before its effects run.
  const immediate = await page.evaluate(async () => {
    const { flushSync } = (await import('/node_modules/.vite/deps/react-dom.js')).default
    const select = document.querySelector<HTMLSelectElement>('#setup-location')!
    flushSync(() => { select.value = 'location-2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    return { selected: select.value, oldInstall: Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes('Установить Authority authority-a1')), oldCandidate: document.body.textContent?.includes('ID authority-a1; срок') }
  })
  expect(immediate).toEqual({ selected: 'location-2', oldInstall: false, oldCandidate: false })
  await expect(page.getByText('Данные терминала не совпадают')).toBeVisible()

  await page.getByLabel('Торговая точка').selectOption('location-1')
  await expect(page.getByRole('button', { name: 'Установить Authority authority-a1' })).toBeVisible()
  const completedA = await page.evaluate(() => window.__setup.completedReads.filter(id => id === 'location-1').length)
  await page.evaluate(() => { window.__setup.holds = ['location-1', 'location-2'] })
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await page.waitForFunction(() => window.__setup.enteredReads.includes('location-1'))
  await page.getByLabel('Торговая точка').selectOption('location-2')
  await page.waitForFunction(() => window.__setup.enteredReads.includes('location-2'))
  await page.evaluate(() => { window.__setup.releases['location-1']?.() })
  await page.waitForFunction(count => window.__setup.completedReads.filter(id => id === 'location-1').length > count, completedA)
  await expect(page.getByRole('button', { name: 'Установить Authority authority-a1' })).toHaveCount(0)
  await expect(page.getByText(/ID authority-a1; срок/)).toHaveCount(0)
  await page.evaluate(() => { window.__setup.releases['location-2']?.(); window.__setup.holds = [] })
  await expect(page.getByText('Данные терминала не совпадают')).toBeVisible()

  await page.getByLabel('Торговая точка').selectOption('location-1')
  await expect(page.getByRole('button', { name: 'Установить Authority authority-a1' })).toBeVisible()
  await page.getByRole('button', { name: 'Установить Authority authority-a1' }).click()
  await expect(page.getByText('Готов сейчас')).toBeVisible()
  const immediateReady = await page.evaluate(async () => {
    const { flushSync } = (await import('/node_modules/.vite/deps/react-dom.js')).default
    const select = document.querySelector<HTMLSelectElement>('#setup-location')!
    flushSync(() => { select.value = 'location-2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    return { selected: select.value, staleReady: Array.from(document.querySelectorAll('h2')).some(heading => heading.textContent === 'Готов сейчас') }
  })
  expect(immediateReady).toEqual({ selected: 'location-2', staleReady: false })
  await expect(page.getByText('Данные терминала не совпадают')).toBeVisible()
})
