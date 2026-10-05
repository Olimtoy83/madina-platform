import { expect, test, type Browser, type Page, type Route } from '@playwright/test'
import {
  withOfflineAcceptanceHarness,
  type OfflineAcceptanceHarness,
} from './offlineAcceptanceHarness'

interface CompletionPayload {
  clientOperationId: string
  saleId: string
  lines: Array<{ id: string; productId: string; quantity: number }>
  allocations: Array<{ id: string; method: string; amountMinor: number; ordinal: number }>
}

interface PendingSnapshot {
  locationId: string
  payload: CompletionPayload
}

function operationEffects(
  harness: OfflineAcceptanceHarness,
  payload: CompletionPayload,
) {
  const database = harness.database
  const count = (statement: string, ...parameters: string[]) => (
    database.prepare(statement).get(...parameters) as { count: number }
  ).count
  const balance = database.prepare(
    'SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?',
  ).get(payload.lines[0]!.productId, harness.locationId) as {
    on_hand_quantity: number
  }

  return {
    sales: count('SELECT COUNT(*) AS count FROM retail_sales WHERE id=?', payload.saleId),
    lines: count('SELECT COUNT(*) AS count FROM retail_sale_items WHERE sale_id=?', payload.saleId),
    allocations: count('SELECT COUNT(*) AS count FROM retail_payment_allocations WHERE sale_id=?', payload.saleId),
    movements: count("SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_sale' AND source_id=?", payload.saleId),
    receipts: count("SELECT COUNT(*) AS count FROM retail_operation_receipts WHERE operation_kind='retail_sale_complete' AND client_operation_id=?", payload.clientOperationId),
    audits: count("SELECT COUNT(*) AS count FROM audit_events WHERE entity_type='retail_sale' AND entity_id=? AND action='retail.sale_completed'", payload.saleId),
    onHandQuantity: balance.on_hand_quantity,
  }
}

async function pendingSnapshot(
  page: Page,
  userId: string,
): Promise<PendingSnapshot | undefined> {
  return page.evaluate(async (ownerUserId) => {
    const recovery = await import('/src/pages/RetailPos/retailPosSubmissionRecovery.ts')
    const result = recovery.loadPendingPosSaleSubmission(ownerUserId)
    return result.status === 'pending' ? result.snapshot : undefined
  }, userId) as Promise<PendingSnapshot | undefined>
}

async function prepareOnlineCheckout(
  page: Page,
  harness: OfflineAcceptanceHarness,
): Promise<void> {
  await page.getByLabel('Торговая точка').selectOption(harness.locationId)
  await page.getByLabel('Поиск товара по названию или коду').fill('Offline acceptance product')
  await page.locator('form').filter({
    has: page.getByLabel('Поиск товара по названию или коду'),
  }).getByRole('button', { name: 'Найти' }).click()
  await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить в корзину' }).click()
  await page.getByRole('button', { name: 'Перейти к оплате' }).click()
  await page.getByLabel('Сумма оплаты 1').fill('1.00')
  await expect(page.getByText('Сумма оплаты совпадает с текущей суммой корзины.')).toBeVisible()
}

test('online POS preserves one frozen recovery operation across lost commit and replay responses', async ({ browser }) => {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      await context.addCookies([{
        name: 'madina-session', value: harness.sessionSecret, url: harness.url, sameSite: 'Lax',
      }])
      const page = await context.newPage()
      await page.goto(`${harness.url}/retail/pos`)
      await expect(page.getByRole('heading', { name: 'Розничная касса' })).toBeVisible()
      await prepareOnlineCheckout(page, harness)

      const requestBodies: CompletionPayload[] = []
      const snapshotsAtTransport: Array<PendingSnapshot | undefined> = []
      const responseStatuses: number[] = []
      let preCommitEffects: ReturnType<typeof operationEffects> | undefined
      let committedEffects: ReturnType<typeof operationEffects> | undefined

      await page.route('**/api/v1/retail/locations/*/sales/complete', async (route: Route) => {
        const payload = route.request().postDataJSON() as CompletionPayload
        requestBodies.push(payload)
        snapshotsAtTransport.push(await pendingSnapshot(page, harness.userId))
        if (requestBodies.length === 1) {
          preCommitEffects = operationEffects(harness, payload)
        }

        const response = await route.fetch()
        responseStatuses.push(response.status())
        const responseBody = await response.json() as { sale: { id: string } }
        expect(responseBody.sale.id).toBe(payload.saleId)

        if (requestBodies.length === 1) {
          expect(response.status()).toBe(201)
          committedEffects = operationEffects(harness, payload)
          expect(preCommitEffects).toBeDefined()
          expect(preCommitEffects).toMatchObject({
            sales: 0,
            lines: 0,
            allocations: 0,
            movements: 0,
            receipts: 0,
            audits: 0,
          })
          expect(committedEffects).toEqual({
            sales: 1,
            lines: payload.lines.length,
            allocations: payload.allocations.length,
            movements: payload.lines.length,
            receipts: 1,
            audits: 1,
            onHandQuantity: preCommitEffects!.onHandQuantity
              - payload.lines.reduce((total, line) => total + line.quantity, 0),
          })
          await route.abort('failed')
          return
        }

        expect(response.status()).toBe(200)
        expect(operationEffects(harness, payload)).toEqual(committedEffects)
        if (requestBodies.length === 2) {
          await route.abort('failed')
          return
        }

        await route.fulfill({ response })
      })

      await page.getByRole('button', { name: 'Завершить продажу' }).click()
      await expect(page.getByText('Новая оплата временно недоступна')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Перейти к оплате' })).toBeDisabled()

      const firstSnapshot = await pendingSnapshot(page, harness.userId)
      expect(firstSnapshot).toBeDefined()
      expect(firstSnapshot).toMatchObject({
        locationId: harness.locationId,
        payload: requestBodies[0],
      })
      expect(snapshotsAtTransport[0]).toMatchObject({
        locationId: harness.locationId,
        payload: requestBodies[0],
      })

      await page.reload()
      await expect(page.getByRole('heading', { name: 'Незавершённая продажа' })).toBeVisible()

      await page.getByRole('button', { name: 'Повторить завершение продажи' }).click()
      await expect(page.getByText('Продажа ожидает безопасной проверки')).toBeVisible()
      const secondSnapshot = await pendingSnapshot(page, harness.userId)
      expect(secondSnapshot).toEqual(firstSnapshot)

      await page.getByRole('button', { name: 'Повторить завершение продажи' }).click()
      await expect(page.getByText('Незавершённая продажа восстановлена')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Незавершённая продажа' })).toHaveCount(0)
      await expect(page.getByText('Новая оплата временно недоступна')).toHaveCount(0)
      await expect.poll(() => pendingSnapshot(page, harness.userId)).toBeUndefined()

      expect(responseStatuses).toEqual([201, 200, 200])
      expect(requestBodies).toHaveLength(3)
      expect(requestBodies[1]).toEqual(requestBodies[0])
      expect(requestBodies[2]).toEqual(requestBodies[0])
      expect(snapshotsAtTransport).toEqual([
        expect.objectContaining({ locationId: harness.locationId, payload: requestBodies[0] }),
        firstSnapshot,
        firstSnapshot,
      ])
      expect(committedEffects).toBeDefined()
      expect(operationEffects(harness, requestBodies[0]!)).toEqual(committedEffects)
    } finally {
      await context.close()
    }
  })
})
