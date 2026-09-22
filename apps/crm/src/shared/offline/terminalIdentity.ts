import { RETAIL_OFFLINE_SIGNATURE_ALGORITHM, exportRetailOfflineTerminalPublicKey, signRetailOfflineEnvelope, type RetailOfflineEnvelope, type RetailOfflineSignedEnvelope } from '@madina/retail'

const databaseName = 'madina-crm:retail-offline-terminal-identity:v1'
const storeName = 'identity'
const recordKey = 'current'
type Pending =
  | { kind: 'enrollment'; commandId: string; locationId: string; publicKey: string }
  | { kind: 'rotation'; commandId: string; locationId: string; terminalId: string; privateKey: CryptoKey; publicKey: string; expectedCurrentKeyVersion: number }
type StoredIdentity = { version: 1; publicKeyAlgorithm: typeof RETAIL_OFFLINE_SIGNATURE_ALGORITHM; publicKey: string; privateKey: CryptoKey; terminalId?: string; locationId?: string; currentKeyVersion?: number; pending?: Pending }
export type TerminalIdentityState = 'KEY_GENERATED' | 'ENROLLED'
export interface TerminalIdentity { readonly version: 1; readonly state: TerminalIdentityState; readonly publicKeyAlgorithm: typeof RETAIL_OFFLINE_SIGNATURE_ALGORITHM; readonly publicKey: string; readonly terminalId?: string; readonly locationId?: string; readonly currentKeyVersion?: number; signOfflineEnvelope(envelope: RetailOfflineEnvelope): Promise<RetailOfflineSignedEnvelope> }
export type PendingTerminalOperation = { readonly kind: Pending['kind']; readonly commandId: string; readonly locationId: string; readonly publicKey: string; readonly expectedCurrentKeyVersion?: number }
export class TerminalIdentityError extends Error {}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new TerminalIdentityError('Retail Offline Terminal identity storage is unavailable.', { cause: request.error }))
  })
}
function read(db: IDBDatabase): Promise<StoredIdentity | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(recordKey)
    request.onsuccess = () => resolve(request.result as StoredIdentity | undefined)
    request.onerror = () => reject(new TerminalIdentityError('Retail Offline Terminal identity cannot be read.', { cause: request.error }))
  })
}
function write(db: IDBDatabase, value: StoredIdentity): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(value, recordKey)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new TerminalIdentityError('Retail Offline Terminal identity cannot be saved.', { cause: transaction.error }))
  })
}
// The decision and the write share one readwrite transaction. No async Web Crypto work runs inside it.
function claim<T>(db: IDBDatabase, decide: (value: StoredIdentity | undefined) => { value?: StoredIdentity; result: T }): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const request = transaction.objectStore(storeName).get(recordKey)
    let result: T
    let failure: unknown
    request.onsuccess = () => {
      try {
        const decision = decide(request.result as StoredIdentity | undefined)
        result = decision.result
        if (decision.value) transaction.objectStore(storeName).put(decision.value, recordKey)
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(failure ?? new TerminalIdentityError('Retail Offline Terminal identity transaction failed.'))
    transaction.onerror = () => reject(new TerminalIdentityError('Retail Offline Terminal identity transaction failed.', { cause: transaction.error }))
  })
}
function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TerminalIdentityError(`Retail Offline Terminal ${label} is invalid.`)
  return value
}
function validKey(key: unknown): key is CryptoKey {
  if (!key || typeof key !== 'object') return false
  try { const value = key as CryptoKey; return value.type === 'private' && value.extractable === false && value.algorithm.name === 'Ed25519' && value.usages.includes('sign') } catch { return false }
}
async function verifyKeyPair(privateKey: CryptoKey, publicKeyText: string): Promise<void> {
  try {
    const publicKey = await crypto.subtle.importKey('spki', Uint8Array.from(atob(publicKeyText), character => character.charCodeAt(0)), { name: 'Ed25519' }, true, ['verify'])
    const challenge = new TextEncoder().encode('madina-retail-offline-terminal-keypair-consistency-v1')
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, challenge)
    if (!await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, challenge)) throw new Error()
  } catch { throw new TerminalIdentityError('Retail Offline Terminal keypair is invalid.') }
}
function enrolled(value: StoredIdentity): boolean {
  return typeof value.terminalId === 'string' && Boolean(value.terminalId.trim()) && typeof value.locationId === 'string' && Boolean(value.locationId.trim()) && Number.isSafeInteger(value.currentKeyVersion) && value.currentKeyVersion! > 0
}
function basicIdentity(value: StoredIdentity): void {
  if (!value || typeof value !== 'object' || value.version !== 1 || value.publicKeyAlgorithm !== RETAIL_OFFLINE_SIGNATURE_ALGORITHM || typeof value.publicKey !== 'string' || !value.publicKey || !validKey(value.privateKey) || (!enrolled(value) && [value.terminalId, value.locationId, value.currentKeyVersion].some(item => item !== undefined))) throw new TerminalIdentityError('Retail Offline Terminal identity is invalid.')
}
async function identity(value: StoredIdentity): Promise<TerminalIdentity> {
  basicIdentity(value)
  await verifyKeyPair(value.privateKey, value.publicKey)
  return { version: 1, state: enrolled(value) ? 'ENROLLED' : 'KEY_GENERATED', publicKeyAlgorithm: value.publicKeyAlgorithm, publicKey: value.publicKey, terminalId: value.terminalId, locationId: value.locationId, currentKeyVersion: value.currentKeyVersion, signOfflineEnvelope: envelope => signRetailOfflineEnvelope(value.privateKey, envelope) }
}
async function validatedPending(value: StoredIdentity): Promise<PendingTerminalOperation | undefined> {
  await identity(value)
  const pending = value.pending
  if (pending === undefined) return undefined
  if (!pending || typeof pending !== 'object') throw new TerminalIdentityError('Retail Offline Terminal pending command is invalid.')
  required(pending.commandId, 'command')
  required(pending.locationId, 'Location')
  if (pending.kind === 'enrollment' && !enrolled(value)) {
    if (typeof pending.publicKey !== 'string' || !pending.publicKey || pending.publicKey !== value.publicKey) throw new TerminalIdentityError('Retail Offline Terminal pending enrollment is invalid.')
    await verifyKeyPair(value.privateKey, pending.publicKey)
    return { kind: 'enrollment', commandId: pending.commandId, locationId: pending.locationId, publicKey: pending.publicKey }
  }
  if (pending.kind !== 'rotation' || !enrolled(value) || pending.locationId !== value.locationId || pending.terminalId !== value.terminalId || pending.expectedCurrentKeyVersion !== value.currentKeyVersion || !validKey(pending.privateKey) || typeof pending.publicKey !== 'string' || !pending.publicKey) throw new TerminalIdentityError('Retail Offline Terminal pending command is invalid.')
  await verifyKeyPair(pending.privateKey, pending.publicKey)
  return { kind: 'rotation', commandId: pending.commandId, locationId: pending.locationId, publicKey: pending.publicKey, expectedCurrentKeyVersion: pending.expectedCurrentKeyVersion }
}
function sameIdentity(current: StoredIdentity | undefined, expected: TerminalIdentity): StoredIdentity {
  if (!current) throw new TerminalIdentityError('Retail Offline Terminal identity is missing.')
  basicIdentity(current)
  if (current.publicKey !== expected.publicKey || current.terminalId !== expected.terminalId || current.locationId !== expected.locationId || current.currentKeyVersion !== expected.currentKeyVersion) throw new TerminalIdentityError('Retail Offline Terminal identity changed during preparation.')
  return current
}
async function withStored<T>(operation: (db: IDBDatabase, value: StoredIdentity) => Promise<T>): Promise<T> {
  const db = await database()
  try { const value = await read(db); if (!value) throw new TerminalIdentityError('Retail Offline Terminal identity is missing.'); await identity(value); return await operation(db, value) } finally { db.close() }
}

export async function loadTerminalIdentity(): Promise<TerminalIdentity | undefined> {
  const db = await database()
  try { const value = await read(db); return value === undefined ? undefined : identity(value) } finally { db.close() }
}
export async function loadPendingTerminalOperation(): Promise<PendingTerminalOperation | undefined> {
  const db = await database()
  try { const value = await read(db); return value === undefined ? undefined : validatedPending(value) } finally { db.close() }
}
export async function generateTerminalIdentity(): Promise<TerminalIdentity> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
  const value: StoredIdentity = { version: 1, publicKeyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: await exportRetailOfflineTerminalPublicKey(pair.publicKey), privateKey: pair.privateKey }
  const db = await database()
  try { await claim(db, current => { if (current) throw new TerminalIdentityError('Retail Offline Terminal identity already exists.'); return { value, result: undefined } }); return identity(value) } finally { db.close() }
}
export async function prepareTerminalEnrollment(commandId: string, locationId: string): Promise<PendingTerminalOperation> {
  const location = required(locationId, 'Location')
  const expected = await loadTerminalIdentity()
  if (!expected || expected.state !== 'KEY_GENERATED') throw new TerminalIdentityError('Retail Offline Terminal identity is not ready for enrollment.')
  const db = await database()
  try {
    const value = await claim(db, current => {
      const actual = sameIdentity(current, expected)
      if (enrolled(actual)) throw new TerminalIdentityError('Retail Offline Terminal identity is already enrolled.')
      if (actual.pending) {
        if (actual.pending.kind !== 'enrollment' || actual.pending.locationId !== location) throw new TerminalIdentityError('Retail Offline Terminal provisioning is already pending.')
        return { result: actual }
      }
      const pending: Pending = { kind: 'enrollment', commandId: required(commandId, 'command'), locationId: location, publicKey: actual.publicKey }
      return { value: { ...actual, pending }, result: { ...actual, pending } }
    })
    const pending = await validatedPending(value)
    if (!pending || pending.kind !== 'enrollment' || pending.locationId !== location) throw new TerminalIdentityError('Retail Offline Terminal pending enrollment is invalid.')
    return pending
  } finally { db.close() }
}
export async function prepareTerminalRotation(commandId: string): Promise<PendingTerminalOperation> {
  const expected = await loadTerminalIdentity()
  if (!expected || expected.state !== 'ENROLLED') throw new TerminalIdentityError('Retail Offline Terminal identity is not enrolled.')
  const existing = await loadPendingTerminalOperation()
  if (existing) { if (existing.kind !== 'rotation') throw new TerminalIdentityError('Retail Offline Terminal provisioning is already pending.'); return existing }
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
  const publicKey = await exportRetailOfflineTerminalPublicKey(pair.publicKey)
  const db = await database()
  try {
    const value = await claim(db, current => {
      const actual = sameIdentity(current, expected)
      if (!enrolled(actual)) throw new TerminalIdentityError('Retail Offline Terminal identity is not enrolled.')
      if (actual.pending) { if (actual.pending.kind !== 'rotation') throw new TerminalIdentityError('Retail Offline Terminal provisioning is already pending.'); return { result: actual } }
      const pending: Pending = { kind: 'rotation', commandId: required(commandId, 'command'), locationId: actual.locationId!, terminalId: actual.terminalId!, privateKey: pair.privateKey, publicKey, expectedCurrentKeyVersion: actual.currentKeyVersion! }
      return { value: { ...actual, pending }, result: { ...actual, pending } }
    })
    const pending = await validatedPending(value)
    if (!pending || pending.kind !== 'rotation') throw new TerminalIdentityError('Retail Offline Terminal pending rotation is invalid.')
    return pending
  } finally { db.close() }
}
export async function enrollTerminalIdentity(input: { terminalId: string; locationId: string; currentKeyVersion: number; commandId: string }): Promise<TerminalIdentity> {
  return withStored(async (db, value) => {
    const pending = await validatedPending(value)
    if (!pending || pending.kind !== 'enrollment' || pending.commandId !== required(input.commandId, 'command') || pending.locationId !== required(input.locationId, 'Location') || !required(input.terminalId, 'terminal id') || input.currentKeyVersion !== 1) throw new TerminalIdentityError('Retail Offline Terminal enrollment identity is invalid.')
    const next = { ...value, terminalId: input.terminalId, locationId: input.locationId, currentKeyVersion: 1, pending: undefined }
    await write(db, next)
    return identity(next)
  })
}
export async function promoteTerminalRotation(input: { terminalId: string; locationId: string; currentKeyVersion: number; commandId: string }): Promise<TerminalIdentity> {
  return withStored(async (db, value) => {
    const operation = await validatedPending(value)
    const pending = value.pending
    if (!operation || operation.kind !== 'rotation' || !pending || pending.kind !== 'rotation' || !enrolled(value) || operation.commandId !== required(input.commandId, 'command') || input.terminalId !== value.terminalId || input.locationId !== value.locationId || input.currentKeyVersion !== pending.expectedCurrentKeyVersion + 1) throw new TerminalIdentityError('Retail Offline Terminal rotation identity is invalid.')
    const next = { ...value, privateKey: pending.privateKey, publicKey: pending.publicKey, currentKeyVersion: input.currentKeyVersion, pending: undefined }
    await write(db, next)
    return identity(next)
  })
}
export async function clearTerminalIdentity(): Promise<void> {
  const db = await database()
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction(storeName, 'readwrite'); transaction.objectStore(storeName).delete(recordKey); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new TerminalIdentityError('Retail Offline Terminal identity cannot be cleared.', { cause: transaction.error })) }) } finally { db.close() }
}
