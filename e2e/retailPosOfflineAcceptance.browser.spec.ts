import { expect, test, type Page } from '@playwright/test'
import { acceptedEffects, databaseWideEffects, withOfflineAcceptanceHarness, type OfflineAcceptanceHarness } from './offlineAcceptanceHarness'

const localDatabaseName = 'madina-crm:retail-offline-terminal-identity:v1'

function stock(harness: OfflineAcceptanceHarness): number {
  return (harness.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?')
    .get(harness.productId, harness.locationId) as { on_hand_quantity: number }).on_hand_quantity
}

async function localState(page: Page) {
  return page.evaluate(async databaseName => {
    const { readLocalOfflineOperations } = await import('/src/shared/offline/offlineOperationsProjection.ts')
    const projection = await readLocalOfflineOperations()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    try {
      const stored = await new Promise<{ sales: any[]; permits: any[] }>((resolve, reject) => {
        const transaction = database.transaction(['offlineSales', 'offlinePermits'], 'readonly')
        const sales = transaction.objectStore('offlineSales').getAll()
        const permits = transaction.objectStore('offlinePermits').getAll()
        transaction.oncomplete = () => resolve({ sales: sales.result, permits: permits.result })
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      return {
        projectionState: projection.state,
        operations: 'operations' in projection ? projection.operations.map(operation => ({ operationId: operation.operationId, state: operation.state })) : [],
        sales: stored.sales.map(sale => ({
          state: sale.state, operationId: sale.envelope.offlineOperationId, proposedSaleId: sale.envelope.proposedSaleId,
          envelope: sale.envelope, canonicalPayload: sale.canonicalPayload, payloadHash: sale.payloadHash,
          signaturePresent: typeof sale.signature === 'string' && sale.signature.length > 0,
          authoritySnapshotPresent: !!sale.authoritySnapshot, committedAtPresent: !!sale.committedAt,
        })),
        consumedPermits: stored.permits.filter(permit => permit.localState === 'CONSUMED_LOCAL').length,
      }
    } finally { database.close() }
  }, localDatabaseName)
}

test('P7 production POS commits offline and App sync accepts exactly one real server Sale', async ({ browser }) => {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      await context.addCookies([{ name: 'madina-session', value: harness.sessionSecret, url: harness.url, sameSite: 'Lax' }])
      const page = await context.newPage()
      await page.goto(`${harness.url}/retail/pos`)
      await expect(page.getByRole('heading', { name: 'Розничная касса' })).toBeVisible()

      const terminalId = await page.evaluate(async locationId => {
        const { beginTerminalEnrollment } = await import('/src/shared/offline/terminalProvisioning.ts')
        return (await beginTerminalEnrollment(locationId)).terminalId
      }, harness.locationId)
      expect(terminalId).toBeTruthy()
      const authority = await harness.offline.issueAuthority({ terminalId, userId: harness.userId, locationId: harness.locationId,
        expiresAt: new Date(Date.now() + 3_600_000), permitCount: 2, productIds: [harness.productId] }, harness.context)
      await page.evaluate(async ({ locationId, authorityId, userId }) => {
        const { installOfflineAuthority } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
        await installOfflineAuthority(locationId, authorityId, userId)
      }, { locationId: harness.locationId, authorityId: authority.id, userId: harness.userId })

      const price = harness.database.prepare('SELECT unit_price_minor FROM retail_product_prices WHERE product_id=? AND location_id=?')
        .get(harness.productId, harness.locationId) as { unit_price_minor: number }
      const authorityPrice = harness.database.prepare('SELECT unit_price_minor FROM retail_offline_authority_product_prices WHERE authority_id=? AND product_id=?')
        .get(authority.id, harness.productId) as { unit_price_minor: number }
      expect(price.unit_price_minor).toBe(100)
      expect(authorityPrice.unit_price_minor).toBe(price.unit_price_minor)
      await page.getByLabel('Торговая точка').selectOption(harness.locationId)
      await page.getByLabel('Поиск товара по названию или коду').fill('Offline acceptance product')
      await page.locator('form').filter({ has: page.getByLabel('Поиск товара по названию или коду') }).getByRole('button', { name: 'Найти' }).click()
      await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
      await page.getByRole('button', { name: 'Добавить в корзину' }).click()
      await page.getByRole('button', { name: 'Перейти к оплате' }).click()
      await page.getByLabel('Сумма оплаты 1').fill('1.00')
      await expect(page.getByText('Сумма оплаты совпадает с текущей суммой корзины.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Сохранить офлайн' })).toBeEnabled()

      const before = databaseWideEffects(harness)
      const stockBefore = stock(harness)
      const localBefore = await localState(page)
      expect(localBefore.operations).toEqual([])
      expect(localBefore.sales).toEqual([])
      expect(stockBefore).toBe(10)
      const onlineSalePosts: string[] = []
      page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/sales/complete')) onlineSalePosts.push(request.url()) })
      const disconnect = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
      await context.route('**/api/**', disconnect)

      await page.getByRole('button', { name: 'Сохранить офлайн' }).click()
      await expect(page.getByRole('heading', { name: 'Подтверждение офлайн-продажи' })).toBeVisible()
      await page.getByRole('button', { name: 'Подтвердить сохранение офлайн' }).click()
      await expect(page.getByText('Сохранено офлайн на этом устройстве')).toBeVisible()
      await expect(page.getByText('Корзина пуста')).toBeVisible()
      const localCommitted = await localState(page)
      expect(localCommitted.projectionState).toBe('ENROLLED')
      expect(localCommitted.operations).toHaveLength(1)
      expect(localCommitted.operations[0]?.state).toBe('WAITING_FIRST_DELIVERY')
      expect(localCommitted.sales).toHaveLength(1)
      const committed = localCommitted.sales[0]!
      const operationId = committed.operationId
      const saleId = committed.proposedSaleId
      await expect(page.getByText(`Операция ${operationId} сохранена локально`, { exact: false })).toBeVisible()
      expect(committed).toMatchObject({ state: 'COMMITTED_LOCAL', signaturePresent: true, authoritySnapshotPresent: true, committedAtPresent: true })
      expect(committed.canonicalPayload).toBeTruthy()
      expect(committed.payloadHash).toBeTruthy()
      expect(committed.envelope).toMatchObject({ offlineOperationId: operationId, proposedSaleId: saleId, locationId: harness.locationId,
        userId: harness.userId, authorityId: authority.id, currencyCode: 'USD', currencyExponent: 2, subtotalMinor: 100, payableTotalMinor: 100,
        lines: [{ productId: harness.productId, quantity: 1, unitPriceMinor: 100 }], cashAllocation: { method: 'cash', amountMinor: 100, ordinal: 0 } })
      expect(localCommitted.consumedPermits).toBe(1)
      expect(onlineSalePosts).toEqual([])
      expect(databaseWideEffects(harness)).toEqual(before)
      expect(stock(harness)).toBe(stockBefore)
      expect(acceptedEffects(harness, operationId, saleId)).toEqual({ sales: 0, lines: 0, allocations: 0, movements: 0, evidence: 0, receipts: 0, audits: 0 })

      const syncResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith(`/api/v1/retail/locations/${harness.locationId}/offline-sales/sync`))
      await context.unroute('**/api/**', disconnect)
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      const response = await syncResponse
      expect(response.status()).toBe(201)
      expect((await response.request().allHeaders()).cookie).toContain('madina-session=')
      expect(response.request().postDataJSON()).toMatchObject({ envelope: committed.envelope, payloadHash: committed.payloadHash })
      expect((await response.json() as { sale: { id: string } }).sale.id).toBe(saleId)
      await expect.poll(async () => (await localState(page)).operations[0]?.state).toBe('ACCEPTED')

      const accepted = await localState(page)
      expect(accepted.operations).toEqual([{ operationId, state: 'ACCEPTED' }])
      expect(accepted.sales).toEqual(localCommitted.sales)
      expect(accepted.consumedPermits).toBe(1)
      const effect = { sales: 1, lines: 1, allocations: 1, movements: 1, evidence: 1, receipts: 1, audits: 1 }
      expect(acceptedEffects(harness, operationId, saleId)).toEqual(effect)
      const after = databaseWideEffects(harness)
      expect(after).toEqual({ sales: before.sales + 1, lines: before.lines + 1, allocations: before.allocations + 1, movements: before.movements + 1,
        evidence: before.evidence + 1, receipts: before.receipts + 1, audits: before.audits + 1 })
      expect(stock(harness)).toBe(stockBefore - 1)
      expect(harness.database.prepare('SELECT location_id,currency_code,currency_exponent,subtotal_minor,payable_total_minor FROM retail_sales WHERE id=?').get(saleId))
        .toMatchObject({ location_id: harness.locationId, currency_code: 'USD', currency_exponent: 2, subtotal_minor: 100, payable_total_minor: 100 })
      expect(harness.database.prepare('SELECT product_id,quantity,unit_price_minor,line_total_minor FROM retail_sale_items WHERE sale_id=?').get(saleId))
        .toMatchObject({ product_id: harness.productId, quantity: 1, unit_price_minor: 100, line_total_minor: 100 })
      expect(harness.database.prepare('SELECT method,amount_minor,ordinal FROM retail_payment_allocations WHERE sale_id=?').get(saleId))
        .toMatchObject({ method: 'cash', amount_minor: 100, ordinal: 0 })
      expect((harness.database.prepare('SELECT COUNT(*) AS count FROM retail_sale_item_discounts WHERE sale_item_id IN (SELECT id FROM retail_sale_items WHERE sale_id=?)').get(saleId) as { count: number }).count).toBe(0)
      expect(harness.database.prepare('SELECT quantity_delta,source_type,source_id FROM retail_inventory_movements WHERE source_type=? AND source_id=?').get('retail_offline_sale_sync', operationId))
        .toMatchObject({ quantity_delta: -1, source_type: 'retail_offline_sale_sync', source_id: operationId })
      expect(harness.database.prepare('SELECT proposed_sale_id,payload_hash FROM retail_offline_sale_evidence WHERE offline_operation_id=?').get(operationId))
        .toMatchObject({ proposed_sale_id: saleId, payload_hash: committed.payloadHash })
      expect(harness.database.prepare('SELECT sale_id,payload_hash FROM retail_offline_sale_sync_receipts WHERE offline_operation_id=?').get(operationId))
        .toMatchObject({ sale_id: saleId, payload_hash: committed.payloadHash })

      await page.getByRole('link', { name: 'Открыть Офлайн-операции' }).click()
      await expect(page.locator('h3 .offline-operations__id')).toHaveText(operationId)
      await page.getByRole('button', { name: 'Обновить локальную диагностику' }).click()
      await expect(page.getByText('Принята — локально наблюдавшийся исход')).toBeVisible()
      await page.reload()
      await expect(page.locator('h3 .offline-operations__id')).toHaveText(operationId)
      await expect(page.getByText('Принята — локально наблюдавшийся исход')).toBeVisible()
      expect(await localState(page)).toEqual(accepted)
      expect(databaseWideEffects(harness)).toEqual(after)
      expect(stock(harness)).toBe(stockBefore - 1)
      expect(acceptedEffects(harness, operationId, saleId)).toEqual(effect)
      expect(onlineSalePosts).toEqual([])
    } finally { await context.close() }
  })
})
