import { expect, test } from '@playwright/test'

const databaseName = 'madina-crm:retail-offline-terminal-identity:v1'
const session = { user: { id: 'user-1', role: 'manager' }, isLoading: false, error: null }
type Permit = { permitId: string; sequence: number; status: 'AVAILABLE' | 'CONSUMED_ACCEPTED' }
type Authority = {
  authorityId: string; authorityVersion: number; terminalId: string; terminalKeyVersion: number; userId: string; locationId: string
  issuedAt: string; expiresAt: string; currencyCode: string; currencyExponent: number; permitCount: number; revoked: boolean
  productPrices: Array<{ productId: string; unitPriceMinor: number }>; permits: Permit[]
  permitCounts: { available: number; conflictPending: number; accepted: number }
  revocation?: { revokedAt: string; revokedByUserId: string; reason: string }
}
function authority(id = 'authority-1'): Authority {
  const permits: Permit[] = [{ permitId: `permit-${id}-0`, sequence: 0, status: 'AVAILABLE' }, { permitId: `permit-${id}-1`, sequence: 1, status: 'AVAILABLE' }]
  return { authorityId: id, authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), currencyCode: 'USD', currencyExponent: 2, permitCount: 2, revoked: false, productPrices: [{ productId: 'product-1', unitPriceMinor: 100 }], permits, permitCounts: { available: 2, conflictPending: 0, accepted: 0 } }
}

test('read-only discovery requires an existing profile and verifies every new-install candidate', async ({ page }) => {
  let listed: Authority[] = [authority()]
  let permitOverride: Permit[] | undefined
  let unavailable = false
  let listOverride: unknown
  let terminalVersion = 1
  let terminalRevoked = false
  let authStatus = 200
  let locationStatus = 200
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (unavailable && path.includes('/offline-authorities/')) return route.abort()
    let body: unknown
    let status = 200
    if (path.endsWith('/auth/me')) { status = authStatus; body = { user: { id: 'user-1', username: 'user-1', role: 'manager' } } }
    else if (path.endsWith('/locations/location-1')) { status = locationStatus; body = { location: { id: 'location-1', status: 'active', type: 'store', currencyCode: 'USD', currencyExponent: 2, createdAt: listed[0]?.issuedAt, updatedAt: listed[0]?.issuedAt } } }
    else if (path.endsWith('/offline-terminals') && route.request().method() === 'POST') { status = 201; body = { terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } } }
    else if (path.endsWith('/offline-terminals/terminal-1/keys/rotate')) { terminalVersion = 2; body = { terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, revoked: false } } }
    else if (path.endsWith('/offline-terminals/terminal-1')) body = { terminal: { terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: terminalVersion, revoked: terminalRevoked } }
    else if (path.endsWith('/offline-authorities')) body = { authorities: listOverride ?? listed.map(({ productPrices: _prices, permits: _permits, permitCounts: _counts, revocation: _revocation, ...summary }) => summary) }
    else if (path.endsWith('/permits')) body = { permits: permitOverride ?? listed.find(item => path.includes(item.authorityId))?.permits }
    else if (path.includes('/offline-authorities/')) body = { authority: listed.find(item => path.endsWith(item.authorityId)) }
    else { status = 404; body = { message: 'Not found' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/test-isolation', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('/test-isolation')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }) }, databaseName)
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([])
  const inspect = () => page.evaluate(async auth => import('/src/shared/offline/offlineAuthorityLedger.ts').then(module => module.listInstallableOfflineAuthorities('location-1', auth as never)), session)
  expect(await inspect()).toEqual({ status: 'IDENTITY_MISSING', authorities: [] })
  expect((await page.evaluate(() => indexedDB.databases())).some(item => item.name === databaseName)).toBe(false)

  await page.evaluate(async () => import('/src/shared/offline/terminalProvisioning.ts').then(module => module.beginTerminalEnrollment('location-1')))
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const tx = db.transaction(['offlineAuthorities', 'offlinePermits', 'offlineMeta'], 'readonly')
    const requests = ['offlineAuthorities', 'offlinePermits', 'offlineMeta'].map(name => tx.objectStore(name).getAll())
    const result = await Promise.all(requests.map(request => new Promise<unknown[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })))
    db.close()
    return result
  })
  expect(await inspect()).toMatchObject({ status: 'OK', authorities: [{ authorityId: 'authority-1', terminalKeyVersion: 1, availablePermitCount: 2 }] })
  const after = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const tx = db.transaction(['offlineAuthorities', 'offlinePermits', 'offlineMeta'], 'readonly')
    const requests = ['offlineAuthorities', 'offlinePermits', 'offlineMeta'].map(name => tx.objectStore(name).getAll())
    const result = await Promise.all(requests.map(request => new Promise<unknown[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })))
    db.close()
    return result
  })
  expect(after).toEqual(before)

  const original = authority()
  for (const changed of [
    { ...original, userId: 'other' }, { ...original, terminalId: 'other' }, { ...original, locationId: 'other' },
    { ...original, terminalKeyVersion: 2 },
    { ...original, revoked: true, revocation: { revokedAt: new Date().toISOString(), revokedByUserId: 'admin', reason: 'test' } },
    { ...original, expiresAt: new Date(Date.now() - 1000).toISOString(), issuedAt: new Date(Date.now() - 60_000).toISOString() },
  ]) { listed = [changed]; expect(await inspect()).toEqual({ status: 'OK', authorities: [] }) }
  const consumed: Permit[] = [{ ...original.permits[0]!, status: 'CONSUMED_ACCEPTED' }, original.permits[1]!]
  listed = [{ ...original, permits: consumed, permitCounts: { available: 1, conflictPending: 0, accepted: 1 } }]
  expect(await inspect()).toEqual({ status: 'OK', authorities: [] })
  listed = [original]
  permitOverride = [original.permits[0]!]
  expect(await inspect()).toEqual({ status: 'SERVER_DATA_INVALID', authorities: [] })
  permitOverride = undefined
  unavailable = true
  expect(await inspect()).toEqual({ status: 'SERVER_UNAVAILABLE', authorities: [] })
  unavailable = false
  listed = [{ ...original, revoked: true, revocation: { revokedAt: new Date().toISOString(), revokedByUserId: 'admin', reason: 'test' } }]
  listOverride = [original]
  expect(await inspect()).toEqual({ status: 'OK', authorities: [] })
  listed = [original]
  listOverride = [{ authorityId: 'bad' }]
  expect(await inspect()).toEqual({ status: 'SERVER_DATA_INVALID', authorities: [] })
  listOverride = undefined
  listed = [authority('authority-z'), authority('authority-a')]
  expect((await inspect()).authorities.map(item => item.authorityId)).toEqual(['authority-a', 'authority-z'])

  await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(module => module.installOfflineAuthority('location-1', 'authority-a', 'user-1')))
  expect((await inspect()).authorities.map(item => item.authorityId)).toEqual(['authority-z'])
  listed = [{ ...listed[0]!, revoked: true, revocation: { revokedAt: new Date().toISOString(), revokedByUserId: 'admin', reason: 'test' } }]
  expect(await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(module => module.installOfflineAuthority('location-1', 'authority-z', 'user-1').then(() => false, () => true)))).toBe(true)
  listed = [authority('authority-z')]
  await page.evaluate(async () => import('/src/shared/offline/terminalProvisioning.ts').then(module => module.beginTerminalKeyRotation('location-1')))
  expect(await inspect()).toEqual({ status: 'OK', authorities: [] })
  expect(await page.evaluate(async () => import('/src/shared/offline/offlineAuthorityLedger.ts').then(module => module.installOfflineAuthority('location-1', 'authority-z', 'user-1').then(() => true, () => false)))).toBe(true)
  listed = [{ ...authority('authority-new'), terminalKeyVersion: 2 }]
  authStatus = 401
  expect(await inspect()).toEqual({ status: 'AUTH_REQUIRED', authorities: [] })
  authStatus = 200
  locationStatus = 403
  expect(await inspect()).toEqual({ status: 'ACCESS_DENIED', authorities: [] })
  locationStatus = 200
  terminalRevoked = true
  expect(await inspect()).toEqual({ status: 'LOCAL_STATE_INVALID', authorities: [] })
  terminalRevoked = false
  const readLedger = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const stores = ['offlineAuthorities', 'offlinePermits', 'offlineMeta']
    const tx = db.transaction(stores, 'readonly')
    const result = await Promise.all(stores.map(async name => {
      const store = tx.objectStore(name)
      const values = await new Promise<unknown[]>((resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { const request = store.getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      return { name, keys, values }
    }))
    db.close()
    return result
  })
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('offlinePermits', 'readwrite'); tx.objectStore('offlinePermits').delete(['authority-a', 0]); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  })
  const corruptedBefore = await readLedger()
  expect(corruptedBefore.find(item => item.name === 'offlinePermits')?.keys).toHaveLength(3)
  expect(await inspect()).toEqual({ status: 'LOCAL_STATE_INVALID', authorities: [] })
  expect(await readLedger()).toEqual(corruptedBefore)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('identity', 'readwrite'); const store = tx.objectStore('identity'); const request = store.get('current'); request.onsuccess = () => store.put({ ...request.result, publicKey: 'corrupt' }, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  })
  expect(await inspect()).toEqual({ status: 'IDENTITY_INVALID', authorities: [] })
})

test('discovery keeps late terminal HTTP failures typed and cannot recreate a deleted profile', async ({ page }) => {
  const item = authority()
  let terminalStatus = 200
  let malformedTerminal = false
  let waitForTerminal = false
  let signalTerminal!: () => void
  let releaseTerminal!: () => void
  const terminalEntered = new Promise<void>(resolve => { signalTerminal = resolve })
  const terminalGate = new Promise<void>(resolve => { releaseTerminal = resolve })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let status = 200
    let body: unknown
    if (path.endsWith('/auth/me')) body = { user: { id: 'user-1', username: 'user-1', role: 'manager' } }
    else if (path.endsWith('/locations/location-1')) body = { location: { id: 'location-1', status: 'active', type: 'store', currencyCode: 'USD', currencyExponent: 2, createdAt: item.issuedAt, updatedAt: item.issuedAt } }
    else if (path.endsWith('/offline-terminals') && route.request().method() === 'POST') { status = 201; body = { terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } } }
    else if (path.endsWith('/offline-terminals/terminal-1')) {
      if (waitForTerminal) { signalTerminal(); await terminalGate }
      status = terminalStatus
      body = malformedTerminal ? { terminal: { terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 'bad', revoked: false } }
        : { terminal: { terminalId: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }
    } else if (path.endsWith('/offline-authorities')) {
      const { productPrices: _prices, permits: _permits, permitCounts: _counts, ...summary } = item
      body = { authorities: [summary] }
    } else if (path.endsWith('/offline-authorities/authority-1/permits')) body = { permits: item.permits }
    else if (path.endsWith('/offline-authorities/authority-1')) body = { authority: item }
    else { status = 404; body = { message: 'Not found' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/test-isolation', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('/test-isolation')
  await page.evaluate(async name => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }) }, databaseName)
  await page.evaluate(async () => import('/src/shared/offline/terminalProvisioning.ts').then(module => module.beginTerminalEnrollment('location-1')))
  const inspect = () => page.evaluate(async auth => import('/src/shared/offline/offlineAuthorityLedger.ts').then(module => module.listInstallableOfflineAuthorities('location-1', auth as never)), session)
  terminalStatus = 401
  expect(await inspect()).toEqual({ status: 'AUTH_REQUIRED', authorities: [] })
  terminalStatus = 403
  expect(await inspect()).toEqual({ status: 'ACCESS_DENIED', authorities: [] })
  terminalStatus = 503
  expect(await inspect()).toEqual({ status: 'SERVER_UNAVAILABLE', authorities: [] })
  terminalStatus = 200
  malformedTerminal = true
  expect(await inspect()).toEqual({ status: 'SERVER_DATA_INVALID', authorities: [] })
  malformedTerminal = false

  waitForTerminal = true
  const pending = inspect()
  await terminalEntered
  const other = await page.context().newPage()
  try {
    await other.route('**/test-isolation', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
    await other.goto('/test-isolation')
    await other.evaluate(async name => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) }) }, databaseName)
    expect((await other.evaluate(() => indexedDB.databases())).some(entry => entry.name === databaseName)).toBe(false)
    releaseTerminal()
    expect(await pending).toMatchObject({ status: 'OK', authorities: [{ authorityId: 'authority-1' }] })
    expect((await other.evaluate(() => indexedDB.databases())).some(entry => entry.name === databaseName)).toBe(false)
  } finally { releaseTerminal(); await other.close() }
})
