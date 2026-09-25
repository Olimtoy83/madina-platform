import { expect, test, type Browser, type Page } from '@playwright/test'
import { withOfflineAcceptanceHarness, type OfflineAcceptanceHarness } from './offlineAcceptanceHarness'

type Effects = ReturnType<typeof effects>

function effects(harness: OfflineAcceptanceHarness) {
  const count = (sql: string) => (harness.database.prepare(sql).get() as { count: number }).count
  return {
    terminals: count('SELECT COUNT(*) AS count FROM retail_offline_terminals'),
    keys: count('SELECT COUNT(*) AS count FROM retail_offline_terminal_keys'),
    authorities: count('SELECT COUNT(*) AS count FROM retail_offline_authorities'),
    prices: count('SELECT COUNT(*) AS count FROM retail_offline_authority_product_prices'),
    permits: count('SELECT COUNT(*) AS count FROM retail_offline_authority_permits'),
    enrollReceipts: count("SELECT COUNT(*) AS count FROM retail_offline_operational_command_receipts WHERE command_type='terminal_enroll'"),
    issueReceipts: count("SELECT COUNT(*) AS count FROM retail_offline_operational_command_receipts WHERE command_type='authority_issue'"),
    enrollAudits: count("SELECT COUNT(*) AS count FROM audit_events WHERE action='retail.offline_terminal_enrolled'"),
    issueAudits: count("SELECT COUNT(*) AS count FROM audit_events WHERE action='retail.offline_authority_issued'"),
  }
}

async function scenario(browser: Browser, run: (harness: OfflineAcceptanceHarness, page: Page) => Promise<void>) {
  await withOfflineAcceptanceHarness(async harness => {
    const context = await browser.newContext()
    try {
      await context.addCookies([{ name: 'madina-session', value: harness.sessionSecret, url: harness.url, sameSite: 'Lax' }])
      const page = await context.newPage()
      await page.goto(`${harness.url}/retail/terminal-setup`)
      await expect(page.getByRole('heading', { name: 'Подготовка терминала' })).toBeVisible()
      await run(harness, page)
    } finally { await context.close() }
  })
}

async function chooseLocation(page: Page, harness: OfflineAcceptanceHarness) {
  await page.getByLabel('Торговая точка').selectOption(harness.locationId)
}

async function register(page: Page, harness: OfflineAcceptanceHarness) {
  await chooseLocation(page, harness)
  await expect(page.getByText('Этот браузер ещё не зарегистрирован')).toBeVisible()
  await page.getByRole('button', { name: 'Зарегистрировать этот браузер' }).click()
  await expect(page.getByText('Локальная Authority ещё не установлена')).toBeVisible()
}

async function browserEvidence(page: Page, locationId: string, authorityId: string) {
  return page.evaluate(async ({ locationId, authorityId }) => {
    const { loadTerminalIdentity } = await import('/src/shared/offline/terminalIdentity.ts')
    const { loadOfflineAuthority } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    const identity = await loadTerminalIdentity()
    const authority = await loadOfflineAuthority(locationId, authorityId)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const localPermits = await new Promise<number>((resolve, reject) => {
        const request = db.transaction('offlinePermits', 'readonly').objectStore('offlinePermits').count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return { terminalId: identity?.terminalId, locationId: identity?.locationId, keyVersion: identity?.currentKeyVersion, publicKey: identity?.publicKey, authorityId: authority?.authorityId, permitCount: authority?.permitCount, localPermits }
    } finally { db.close() }
  }, { locationId, authorityId })
}

function serverIdentity(harness: OfflineAcceptanceHarness) {
  return harness.database.prepare(`
    SELECT t.id AS terminalId, t.location_id AS locationId, t.current_key_version AS keyVersion, k.public_key AS publicKey
    FROM retail_offline_terminals t JOIN retail_offline_terminal_keys k
      ON k.terminal_id=t.id AND k.key_version=t.current_key_version
  `).get() as { terminalId: string; locationId: string; keyVersion: number; publicKey: string }
}

test('T1 new browser reaches READY; T2 same profile reload stays READY without duplicates', async ({ browser }) => {
  await scenario(browser, async (harness, page) => {
    expect(effects(harness)).toEqual({ terminals: 0, keys: 0, authorities: 0, prices: 0, permits: 0, enrollReceipts: 0, issueReceipts: 0, enrollAudits: 0, issueAudits: 0 })
    await register(page, harness)
    expect(effects(harness).terminals).toBe(1)
    await expect(page.getByText('Совместимая существующая Authority не найдена', { exact: false })).toBeVisible()

    const expiry = new Date(Date.now() + 3_600_000)
    const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    await page.getByLabel('Срок действия').fill(localExpiry)
    await page.getByLabel('Число офлайн-разрешений').fill('2')
    await page.getByLabel('Товар из каталога').fill('Offline acceptance product')
    await page.getByRole('button', { name: 'Найти товары' }).click()
    await expect(page.getByRole('button', { name: 'Добавить' })).toBeVisible()
    await page.getByRole('button', { name: 'Добавить' }).click()
    await expect(page.getByText('Выбрано товаров: 1')).toBeVisible()
    await page.getByRole('button', { name: 'Начать выпуск Authority' }).click()
    await expect(page.getByText('Выпуск подтверждён, но Authority ещё не установлена')).toBeVisible()
    await expect(page.getByText('Готов сейчас')).toHaveCount(0)

    const authority = harness.database.prepare('SELECT id,terminal_id,terminal_key_version,user_id,location_id,permit_count FROM retail_offline_authorities').get() as { id: string; terminal_id: string; terminal_key_version: number; user_id: string; location_id: string; permit_count: number }
    const terminal = serverIdentity(harness)
    expect(authority).toMatchObject({ terminal_id: terminal.terminalId, terminal_key_version: 1, user_id: harness.userId, location_id: harness.locationId, permit_count: 2 })
    expect(effects(harness)).toEqual({ terminals: 1, keys: 1, authorities: 1, prices: 1, permits: 2, enrollReceipts: 1, issueReceipts: 1, enrollAudits: 1, issueAudits: 1 })
    await page.getByRole('button', { name: `Установить Authority ${authority.id}` }).click()
    await expect(page.getByText('Готов сейчас')).toBeVisible()
    await expect(page.getByText('Доступных разрешений: 2.', { exact: false })).toBeVisible()
    const before = await browserEvidence(page, harness.locationId, authority.id)
    expect(before).toEqual({ terminalId: terminal.terminalId, locationId: terminal.locationId, keyVersion: terminal.keyVersion, publicKey: terminal.publicKey, authorityId: authority.id, permitCount: 2, localPermits: 2 })
    const beforeEffects: Effects = effects(harness)

    const setupPosts: string[] = []
    page.on('request', request => { if (request.method() === 'POST' && /offline-(terminals|authorities)/.test(request.url())) setupPosts.push(request.url()) })
    await page.reload()
    await chooseLocation(page, harness)
    await expect(page.getByText('Готов сейчас')).toBeVisible()
    expect(await browserEvidence(page, harness.locationId, authority.id)).toEqual(before)
    expect(effects(harness)).toEqual(beforeEffects)
    expect(setupPosts).toEqual([])
    await expect(page.getByRole('button', { name: 'Зарегистрировать этот браузер' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
  })
})

test('T3 existing server Authority is discovered and explicitly installed without new issuance', async ({ browser }) => {
  await scenario(browser, async (harness, page) => {
    await register(page, harness)
    const terminal = serverIdentity(harness)
    const existing = await harness.offline.issueAuthority({ terminalId: terminal.terminalId, userId: harness.userId, locationId: harness.locationId, expiresAt: new Date(Date.now() + 3_600_000), permitCount: 2, productIds: [harness.productId] }, harness.context)
    const beforeEffects = effects(harness)
    expect(beforeEffects).toMatchObject({ authorities: 1, permits: 2, issueReceipts: 1, issueAudits: 1 })
    await page.getByRole('button', { name: 'Проверить снова' }).click()
    await expect(page.getByText(`ID ${existing.id}; срок`, { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать выпуск Authority' })).toHaveCount(0)
    await page.getByRole('button', { name: `Установить Authority ${existing.id}` }).click()
    await expect(page.getByText('Готов сейчас')).toBeVisible()
    expect(await browserEvidence(page, harness.locationId, existing.id)).toEqual({ terminalId: terminal.terminalId, locationId: terminal.locationId, keyVersion: terminal.keyVersion, publicKey: terminal.publicKey, authorityId: existing.id, permitCount: 2, localPermits: 2 })
    expect(effects(harness)).toEqual(beforeEffects)
  })
})
