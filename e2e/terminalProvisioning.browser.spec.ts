import { expect, test } from '@playwright/test'
import { verifyRetailOfflineEnvelope } from '../packages/database/src/retail/retailOfflineEnvelopeCrypto.ts'

const envelope = { schemaVersion: 1, offlineOperationId: 'provisioning-op', authorityId: 'authority-1', authorityVersion: 1, permitId: 'permit-1', permitSequence: 0, terminalId: 'terminal-1', terminalKeyVersion: 2, userId: 'user-1', locationId: 'location-1', proposedSaleId: 'sale-1', lines: [{ id: 'line-1', productId: 'product-1', quantity: 1, unitPriceMinor: 100 }], currencyCode: 'USD', currencyExponent: 2, cashAllocation: { id: 'payment-1', method: 'cash', amountMinor: 100, ordinal: 0 }, subtotalMinor: 100, payableTotalMinor: 100, claimedOfflineCompletedAt: '2026-09-22T00:00:00.000Z' } as const

async function clear(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.evaluate(async () => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) })
}

test('concurrent enrollment has one durable command and exact replay after reload', async ({ page }) => {
  await clear(page)
  const concurrent = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    await identity.generateTerminalIdentity()
    const sent: unknown[] = []
    globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body))); throw new TypeError('response lost') }
    await Promise.allSettled([service.beginTerminalEnrollment('location-1'), service.beginTerminalEnrollment('location-1')])
    const pending = await identity.loadPendingTerminalOperation()
    const foreignRejected = await service.beginTerminalEnrollment('location-2').then(() => false, () => true)
    return { sent, pending, foreignRejected, state: await service.getTerminalProvisioningState() }
  })
  expect(concurrent.sent).toHaveLength(2)
  expect(concurrent.sent[0]).toEqual(concurrent.sent[1])
  expect(concurrent.pending).toMatchObject({ kind: 'enrollment', locationId: 'location-1', commandId: (concurrent.sent[0] as { commandId: string }).commandId, publicKey: (concurrent.sent[0] as { publicKey: string }).publicKey })
  expect(concurrent.foreignRejected).toBe(true)
  expect(concurrent.state).toBe('KEY_GENERATED')
  await page.reload()
  const recovered = await page.evaluate(async () => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    let malformedBody: unknown, replay: unknown
    globalThis.fetch = async (_url, init) => { malformedBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', revoked: false } }), { status: 201, headers: { 'Content-Type': 'application/json' } }) }
    const malformedRejected = await service.beginTerminalEnrollment('location-1').then(() => false, () => true)
    const stateAfterMalformed = await service.getTerminalProvisioningState()
    globalThis.fetch = async (_url, init) => { replay = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { status: 201, headers: { 'Content-Type': 'application/json' } }) }
    const value = await service.beginTerminalEnrollment('location-1')
    globalThis.fetch = async () => new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
    const stable = await service.reconcileTerminal('location-1')
    globalThis.fetch = async () => { throw new TypeError('offline') }
    const unavailable = await service.reconcileTerminal('location-1')
    return { malformedBody, replay, malformedRejected, stateAfterMalformed, terminalId: value.terminalId, locationId: value.locationId, keyVersion: value.currentKeyVersion, stable, unavailable }
  })
  expect(recovered.malformedBody).toEqual(concurrent.sent[0])
  expect(recovered.replay).toEqual(concurrent.sent[0])
  expect(recovered).toMatchObject({ malformedRejected: true, stateAfterMalformed: 'KEY_GENERATED', terminalId: 'terminal-1', locationId: 'location-1', keyVersion: 1, stable: 'ENROLLED', unavailable: 'UNAVAILABLE' })
})

test('pending enrollment rejects replaced active keypair and swapped pending SPKI before HTTP', async ({ page }) => {
  await clear(page)
  const prepared = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    const active = await identity.generateTerminalIdentity()
    const pending = await identity.prepareTerminalEnrollment('command-1', 'location-1')
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const original = await new Promise<any>((resolve, reject) => { const r = db.transaction('identity', 'readonly').objectStore('identity').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const spki = await crypto.subtle.exportKey('spki', other.publicKey)
    const otherPublicKey = btoa(String.fromCharCode(...new Uint8Array(spki)))
    await new Promise<void>((resolve, reject) => { const t = db.transaction('identity', 'readwrite'); t.objectStore('identity').put({ ...original, privateKey: other.privateKey, publicKey: otherPublicKey }, 'current'); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error) })
    db.close()
    return { activePublicKey: active.publicKey, pending, otherPublicKey, otherExtractable: other.privateKey.extractable }
  })
  expect(prepared.pending).toMatchObject({ kind: 'enrollment', commandId: 'command-1', locationId: 'location-1', publicKey: prepared.activePublicKey })
  expect(prepared.otherPublicKey).not.toBe(prepared.activePublicKey)
  expect(prepared.otherExtractable).toBe(false)
  await page.reload()
  const replacedActive = await page.evaluate(async () => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    let requests = 0
    globalThis.fetch = async () => { requests++; throw new Error('unexpected HTTP') }
    const rejected = await service.beginTerminalEnrollment('location-1').then(() => false, () => true)
    return { rejected, requests }
  })
  expect(replacedActive).toEqual({ rejected: true, requests: 0 })

  const swappedPending = await page.evaluate(async () => {
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    await identity.clearTerminalIdentity()
    await identity.generateTerminalIdentity()
    await identity.prepareTerminalEnrollment('command-2', 'location-1')
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const spki = await crypto.subtle.exportKey('spki', other.publicKey)
    const otherPublicKey = btoa(String.fromCharCode(...new Uint8Array(spki)))
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const record = await new Promise<any>((resolve, reject) => { const r = db.transaction('identity', 'readonly').objectStore('identity').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const t = db.transaction('identity', 'readwrite'); t.objectStore('identity').put({ ...record, pending: { ...record.pending, publicKey: otherPublicKey } }, 'current'); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error) })
    db.close()
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    let requests = 0
    globalThis.fetch = async () => { requests++; throw new Error('unexpected HTTP') }
    const rejected = await service.beginTerminalEnrollment('location-1').then(() => false, () => true)
    return { rejected, requests }
  })
  expect(swappedPending).toEqual({ rejected: true, requests: 0 })
})

test('rotation retains active key, replays after reload, and promotes the signing key', async ({ page }) => {
  await clear(page)
  const before = await page.evaluate(async () => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    globalThis.fetch = async () => new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    const enrolled = await service.beginTerminalEnrollment('location-1')
    let firstPost: unknown
    globalThis.fetch = async (url, init) => {
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
      firstPost = { url: String(url), body: JSON.parse(String(init.body)) }
      throw new TypeError('response lost')
    }
    await service.beginTerminalKeyRotation('location-1').catch(() => undefined)
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    const active = await identity.loadTerminalIdentity()
    const pending = await identity.loadPendingTerminalOperation()
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const record = await new Promise<any>((resolve, reject) => { const r = db.transaction('identity', 'readonly').objectStore('identity').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    db.close()
    return { firstPost, activeVersion: active?.currentKeyVersion, activePublicKey: enrolled.publicKey, pending, pendingExtractable: record.pending.privateKey.extractable, state: await service.getTerminalProvisioningState() }
  })
  expect(before.activeVersion).toBe(1)
  expect(before.state).toBe('ROTATION_PENDING')
  expect(before.pendingExtractable).toBe(false)
  await page.reload()
  const after = await page.evaluate(async input => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    let retry: unknown
    globalThis.fetch = async (url, init) => {
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
      retry = { url: String(url), body: JSON.parse(String(init.body)) }
      return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, revoked: false } }), { headers: { 'Content-Type': 'application/json' } })
    }
    const pendingState = await service.reconcileTerminal('location-1')
    const promoted = await service.beginTerminalKeyRotation('location-1')
    const loaded = await import('/src/shared/offline/terminalIdentity.ts').then(module => module.loadTerminalIdentity())
    if (!loaded) throw new Error('missing promoted identity')
    const signed = await loaded.signOfflineEnvelope(input)
    let postCount = 0
    globalThis.fetch = async (_url, init) => {
      if (init?.method === 'POST') postCount++
      return new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 2, revoked: true } }), { headers: { 'Content-Type': 'application/json' } })
    }
    const revoked = await service.reconcileTerminal('location-1')
    const rotateRejected = await service.beginTerminalKeyRotation('location-1').then(() => false, () => true)
    return { retry, pendingState, promotedVersion: promoted.currentKeyVersion, promotedPublicKey: promoted.publicKey, signed, state: await service.getTerminalProvisioningState(), revoked, rotateRejected, postCount }
  }, envelope)
  expect(after.pendingState).toBe('ROTATION_PENDING')
  expect(after.retry).toEqual(before.firstPost)
  expect(after.promotedVersion).toBe(2)
  expect(after.promotedPublicKey).toBe(before.pending?.publicKey)
  expect(after.promotedPublicKey).not.toBe(before.activePublicKey)
  expect(verifyRetailOfflineEnvelope({ envelope, payloadHash: after.signed.payloadHash, signature: after.signed.signature, keyAlgorithm: 'ed25519-spki-der-base64-v1', publicKey: after.promotedPublicKey }).payloadHash).toBe(after.signed.payloadHash)
  expect(() => verifyRetailOfflineEnvelope({ envelope, payloadHash: after.signed.payloadHash, signature: after.signed.signature, keyAlgorithm: 'ed25519-spki-der-base64-v1', publicKey: before.activePublicKey })).toThrow()
  expect(after).toMatchObject({ state: 'ENROLLED', revoked: 'REVOKED', rotateRejected: true, postCount: 0 })
})

test('swapped pending rotation SPKI fails before HTTP and storage loss never rebinds', async ({ page }) => {
  await clear(page)
  const tampered = await page.evaluate(async () => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    globalThis.fetch = async () => new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    const active = await service.beginTerminalEnrollment('location-1')
    globalThis.fetch = async (_url, init) => init?.method === 'POST' ? Promise.reject(new TypeError('response lost')) : Promise.resolve(new Response(JSON.stringify({ terminal: { id: 'terminal-1', locationId: 'location-1', currentKeyVersion: 1, revoked: false } }), { headers: { 'Content-Type': 'application/json' } }))
    await service.beginTerminalKeyRotation('location-1').catch(() => undefined)
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const spki = await crypto.subtle.exportKey('spki', other.publicKey)
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(spki)))
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('madina-crm:retail-offline-terminal-identity:v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const record = await new Promise<any>((resolve, reject) => { const r = db.transaction('identity', 'readonly').objectStore('identity').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => { const t = db.transaction('identity', 'readwrite'); t.objectStore('identity').put({ ...record, pending: { ...record.pending, publicKey } }, 'current'); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error) })
    db.close()
    return { activePublicKey: active.publicKey, activeVersion: active.currentKeyVersion }
  })
  await page.reload()
  const result = await page.evaluate(async () => {
    const service = await import('/src/shared/offline/terminalProvisioning.ts')
    let requests = 0
    globalThis.fetch = async () => { requests++; throw new Error('unexpected HTTP') }
    const rejected = await service.beginTerminalKeyRotation('location-1').then(() => false, () => true)
    const identity = await import('/src/shared/offline/terminalIdentity.ts')
    const active = await identity.loadTerminalIdentity()
    await identity.clearTerminalIdentity()
    const afterClear = await service.getTerminalProvisioningState()
    const reconcileAfterClear = await service.reconcileTerminal('location-1')
    return { rejected, requests, activePublicKey: active?.publicKey, activeVersion: active?.currentKeyVersion, afterClear, reconcileAfterClear }
  })
  expect(result).toEqual({ rejected: true, requests: 0, activePublicKey: tampered.activePublicKey, activeVersion: tampered.activeVersion, afterClear: 'UNINITIALIZED', reconcileAfterClear: 'IDENTITY_LOST' })
})
