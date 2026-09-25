import { expect, test } from '@playwright/test'

const name = 'madina-crm:retail-offline-terminal-identity:v1'
const auth = { user: { id: 'user-1', role: 'manager' }, isLoading: false, error: null }

test('readiness observes real IndexedDB without creating state and remains READY after reload', async ({ page }) => {
  const permits = [{ permitId: 'permit-1', sequence: 0, status: 'AVAILABLE' }]
  const authority = {
    authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1,
    userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2,
    permitCount: 1, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }], permits,
    permitCounts: { available: 1, conflictPending: 0, accepted: 0 },
  }
  await page.route('**/api/v1/retail/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let body: unknown
    let status = 200
    if (path.endsWith('/locations/location-1')) body = { location: { id: 'location-1', status: 'active', type: 'store', currencyCode: 'USD', currencyExponent: 2, createdAt: authority.issuedAt, updatedAt: authority.issuedAt } }
    else if (path.endsWith('/offline-terminals') && route.request().method() === 'POST') { status = 201; body = { terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } } }
    else if (path.endsWith('/offline-terminals/terminal-1')) body = { terminal: { terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }
    else if (path.endsWith('/offline-authorities/authority-1/permits')) body = { permits }
    else if (path.endsWith('/offline-authorities/authority-1')) body = { authority }
    else { status = 404; body = { message: 'Not found' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/')
  await page.evaluate(async databaseName => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }) }, name)
  const clean = await page.evaluate(async session => {
    const { checkTerminalReadiness } = await import('/src/shared/offline/terminalReadiness.ts')
    const result = await checkTerminalReadiness('location-1', session as never)
    return { result, databases: await indexedDB.databases() }
  }, auth)
  expect(clean.result).toMatchObject({ reason: 'IDENTITY_MISSING', serverVerified: false })
  expect(clean.databases.some(item => item.name === name)).toBe(false)

  await page.evaluate(async () => {
    const { beginTerminalEnrollment } = await import('/src/shared/offline/terminalProvisioning.ts')
    const { installOfflineAuthority } = await import('/src/shared/offline/offlineAuthorityLedger.ts')
    await beginTerminalEnrollment('location-1')
    await installOfflineAuthority('location-1', 'authority-1', 'user-1')
  })
  const observe = () => page.evaluate(async session => {
    const { checkTerminalReadiness } = await import('/src/shared/offline/terminalReadiness.ts')
    const result = await checkTerminalReadiness('location-1', session as never)
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const stored = await new Promise<{ privateKey: CryptoKey }>((resolve, reject) => { const request = db.transaction('identity', 'readonly').objectStore('identity').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    db.close()
    return { result, extractable: stored.privateKey.extractable }
  }, auth)
  const first = await observe()
  expect(first.result).toMatchObject({ status: 'READY', reason: 'READY', terminalId: 'terminal-1', terminalKeyVersion: 1, authorityId: 'authority-1', availablePermitCount: 1, serverVerified: true })
  expect(first.extractable).toBe(false)
  expect(JSON.stringify(first.result)).not.toContain('privateKey')
  await page.reload()
  const reloaded = await observe()
  expect(reloaded.result).toEqual(first.result)
  expect(reloaded.extractable).toBe(false)
})
