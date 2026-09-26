import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { withOfflineAcceptanceHarness, type OfflineAcceptanceHarness } from './offlineAcceptanceHarness'

async function scenario(browser: Browser, run: (harness: OfflineAcceptanceHarness, context: BrowserContext, page: Page) => Promise<void>) {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      await context.addCookies([{ name: 'madina-session', value: harness.sessionSecret, url: harness.url, sameSite: 'Lax' }])
      const page = await context.newPage()
      await page.goto(`${harness.url}/retail/pos`)
      await expect(page.getByRole('heading', { name: 'Розничная касса' })).toBeVisible()
      await run(harness, context, page)
    } finally { await context.close() }
  })
}

async function provision(page: Page, harness: OfflineAcceptanceHarness) {
  const terminalId = await page.evaluate(async locationId => {
    const { beginTerminalEnrollment } = await import('/src/shared/offline/terminalProvisioning.ts')
    return (await beginTerminalEnrollment(locationId)).terminalId
  }, harness.locationId)
  if (!terminalId) throw new Error('No terminal ID after enrollment.')
  const authority = await harness.offline.issueAuthority({ terminalId, userId: harness.userId, locationId: harness.locationId,
    expiresAt: new Date(Date.now() + 3_600_000), permitCount: 2, productIds: [harness.productId] }, harness.context)
  await page.evaluate(async ({ locationId, authorityId, userId }) => {
    const { installOfflineAuthority } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    await installOfflineAuthority(locationId, authorityId, userId)
  }, { locationId: harness.locationId, authorityId: authority.id, userId: harness.userId })
}

async function cart(page: Page, harness: OfflineAcceptanceHarness) {
  await page.getByLabel('Торговая точка').selectOption(harness.locationId)
  await page.getByLabel('Поиск товара по названию или коду').fill('Offline acceptance product')
  await page.locator('form').filter({ has: page.getByLabel('Поиск товара по названию или коду') }).getByRole('button', { name: 'Найти' }).click()
  await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить в корзину' }).click()
  await page.getByRole('button', { name: 'Перейти к оплате' }).click()
  await page.getByLabel('Сумма оплаты 1').fill('1.00')
  await expect(page.getByText('Сумма оплаты совпадает с текущей суммой корзины.')).toBeVisible()
}

async function localSales(page: Page) {
  return page.evaluate(async () => {
    const { readLocalOfflineOperations } = await import('/src/shared/offline/offlineOperationsProjection.ts')
    const projection = await readLocalOfflineOperations()
    return 'operations' in projection ? projection.operations : []
  })
}

async function prepareWithObservedIds(page: Page, forcedId?: string): Promise<string[]> {
  await page.evaluate(forced => {
    const original = crypto.randomUUID.bind(crypto)
    const ids: string[] = []
    ;(window as any).__posOperationIds = ids
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const id = forced ?? original()
      ids.push(id)
      return id
    } })
  }, forcedId)
  try {
    await page.getByRole('button', { name: 'Сохранить офлайн' }).click()
    await expect(page.getByRole('heading', { name: 'Подтверждение офлайн-продажи' })).toBeVisible()
    return await page.evaluate(() => (window as any).__posOperationIds as string[])
  } finally {
    await page.evaluate(() => { delete (crypto as any).randomUUID; delete (window as any).__posOperationIds })
  }
}

async function storedSaleJson(page: Page, operationId: string): Promise<string> {
  return page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = db.transaction('offlineSales', 'readonly').objectStore('offlineSales').get(id)
        request.onsuccess = () => resolve(JSON.stringify(request.result))
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  }, operationId)
}

async function localPermitStates(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const request = db.transaction('offlinePermits', 'readonly').objectStore('offlinePermits').getAll()
        request.onsuccess = () => resolve((request.result as Array<{ localState: string }>).map(permit => permit.localState))
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}

async function disconnect(context: BrowserContext) {
  await context.route('**/api/**', route => route.abort('internetdisconnected'))
}

test('P1 READY cash explicit offline commit is durable and never posts online Sale', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    await provision(page, harness)
    await cart(page, harness)
    await expect(page.getByRole('button', { name: 'Сохранить офлайн' })).toBeEnabled()
    const onlinePosts: string[] = []
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/sales/complete')) onlinePosts.push(request.url()) })
    await disconnect(context)
    await page.getByRole('button', { name: 'Сохранить офлайн' }).click()
    await expect(page.getByRole('heading', { name: 'Подтверждение офлайн-продажи' })).toBeVisible()
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()
    await expect(page.getByText('Сохранено офлайн на этом устройстве')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Открыть Офлайн-операции' })).toHaveAttribute('href', '/retail/offline-operations')
    await expect(page.getByText('Корзина пуста')).toBeVisible()
    expect((await localSales(page)).map(sale => sale.state)).toEqual(['WAITING_FIRST_DELIVERY'])
    expect(onlinePosts).toEqual([])
  })
})

test('P2 not-ready terminal blocks offline action and preserves cart', async ({ browser }) => {
  await scenario(browser, async (harness, _context, page) => {
    await cart(page, harness)
    await expect(page.getByRole('button', { name: 'Сохранить офлайн' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
    expect(await localSales(page)).toEqual([])
  })
})

test('P3 card, discount, and Authority/POS price mismatch each block commit', async ({ browser }) => {
  await scenario(browser, async (harness, _context, page) => {
    await provision(page, harness)
    await cart(page, harness)
    const save = page.getByRole('button', { name: 'Сохранить офлайн' })
    await page.getByLabel('Способ оплаты').selectOption('card')
    await save.click()
    await expect(page.getByText('Офлайн-продажа недоступна:', { exact: false })).toBeVisible()
    expect(await localSales(page)).toEqual([])
    await page.getByLabel('Способ оплаты').selectOption('cash')
    await page.getByLabel('Сумма скидки для Offline acceptance product').fill('0.10')
    await page.getByRole('button', { name: 'Применить скидку' }).click()
    await page.getByRole('button', { name: 'Перейти к оплате' }).click()
    await page.getByLabel('Сумма оплаты 1').fill('0.90')
    await save.click()
    expect(await localSales(page)).toEqual([])
    await page.getByRole('button', { name: 'Убрать скидку' }).click()
    await page.getByRole('button', { name: 'Очистить' }).click()
    harness.database.prepare('UPDATE retail_product_prices SET unit_price_minor=200 WHERE product_id=? AND location_id=?').run(harness.productId, harness.locationId)
    await page.locator('form').filter({ has: page.getByLabel('Поиск товара по названию или коду') }).getByRole('button', { name: 'Найти' }).click()
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить в корзину' }).click()
    await page.getByRole('button', { name: 'Перейти к оплате' }).click()
    await page.getByLabel('Сумма оплаты 1').fill('2.00')
    await save.click()
    await expect(page.getByText('Цена товара отличается от офлайн-разрешения.', { exact: false })).toBeVisible()
    expect(await localSales(page)).toEqual([])
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
  })
})

test('P4 local transaction failure keeps cart and permits safe retry', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    await provision(page, harness)
    await cart(page, harness)
    await disconnect(context)
    const firstIds = await prepareWithObservedIds(page)
    expect(firstIds).toHaveLength(1)
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction
      ;(window as any).__restoreTransaction = () => { IDBDatabase.prototype.transaction = original }
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        if (mode === 'readwrite' && Array.from(typeof stores === 'string' ? [stores] : stores).includes('offlineSales')) throw new Error('Test-only local transaction failure')
        return original.call(this, stores, mode, options)
      }
    })
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()
    await expect(page.getByText('Офлайн-продажа не подтверждена. Корзина сохранена;', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
    expect(await localSales(page)).toEqual([])
    await page.evaluate(() => (window as any).__restoreTransaction())
    const retryIds = await prepareWithObservedIds(page)
    expect(retryIds).toEqual([])
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()
    await expect(page.getByText('Сохранено офлайн на этом устройстве')).toBeVisible()
    await expect(page.getByText('Корзина пуста')).toBeVisible()
    const sales = await localSales(page)
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({ operationId: firstIds[0], state: 'WAITING_FIRST_DELIVERY' })
    expect((await localPermitStates(page)).filter(state => state === 'CONSUMED_LOCAL')).toHaveLength(1)
  })
})

test('P5 rapid repeated confirmation creates one operation and consumes one permit', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    await provision(page, harness)
    await cart(page, harness)
    await disconnect(context)
    const ids = await prepareWithObservedIds(page)
    expect(ids).toHaveLength(1)
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).evaluate(button => {
      ;(button as HTMLButtonElement).click(); (button as HTMLButtonElement).click()
    })
    await expect(page.getByText('Сохранено офлайн на этом устройстве')).toBeVisible()
    const sales = await localSales(page)
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({ operationId: ids[0], state: 'WAITING_FIRST_DELIVERY' })
    expect((await localPermitStates(page)).filter(state => state === 'CONSUMED_LOCAL')).toHaveLength(1)
  })
})

test('BLOCKER: conflicting durable operationId cannot clear a different POS checkout', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    await provision(page, harness)
    await cart(page, harness)
    await disconnect(context)
    const firstIds = await prepareWithObservedIds(page)
    expect(firstIds).toHaveLength(1)
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()
    await expect(page.getByText('Сохранено офлайн на этом устройстве')).toBeVisible()
    const firstEvidence = await storedSaleJson(page, firstIds[0]!)
    expect((await localPermitStates(page)).filter(state => state === 'CONSUMED_LOCAL')).toHaveLength(1)

    await page.getByRole('button', { name: 'Добавить в корзину' }).click()
    await page.getByRole('button', { name: 'Увеличить количество Offline acceptance product' }).click()
    await page.getByRole('button', { name: 'Перейти к оплате' }).click()
    await page.getByLabel('Сумма оплаты 1').fill('2.00')
    expect(await prepareWithObservedIds(page, firstIds[0])).toEqual([firstIds[0]])
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()

    await expect(page.getByText('Локальный исход требует безопасной проверки.', { exact: false })).toBeVisible()
    await expect(page.getByText('Сохранено офлайн на этом устройстве')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
    expect(await localSales(page)).toHaveLength(1)
    expect(await storedSaleJson(page, firstIds[0]!)).toBe(firstEvidence)
    expect((await localPermitStates(page)).filter(state => state === 'CONSUMED_LOCAL')).toHaveLength(1)
  })
})

test('P6 committed sale remains visible in Offline Operations after reload without server sync', async ({ browser }) => {
  await scenario(browser, async (harness, context, page) => {
    await provision(page, harness)
    await cart(page, harness)
    await context.route('**/offline-sales/sync', route => route.abort('internetdisconnected'))
    await page.getByRole('button', { name: 'Сохранить офлайн' }).click()
    await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()
    await expect(page.getByText('Сохранено офлайн на этом устройстве')).toBeVisible()
    const sales = await localSales(page)
    expect(sales).toHaveLength(1)
    await page.getByRole('link', { name: 'Открыть Офлайн-операции' }).click()
    await expect(page.locator('h3 .offline-operations__id')).toHaveText(sales[0]!.operationId)
    await page.reload()
    await expect(page.locator('h3 .offline-operations__id')).toHaveText(sales[0]!.operationId)
    expect((await localSales(page)).map(sale => sale.operationId)).toEqual([sales[0]!.operationId])
    expect((harness.database.prepare('SELECT COUNT(*) AS count FROM retail_sales').get() as { count: number }).count).toBe(0)
  })
})
