import { useRef } from 'react'
import { requestJson } from '../api/httpClient'
import { useAuth } from '../../context/useAuth'
import { reconcileTerminal } from './terminalProvisioning'
import { loadPendingTerminalOperation, loadTerminalIdentity, type TerminalIdentity } from './terminalIdentity'
import { authorityStoreName, identityRecordKey, identityStoreName, metadataRecordKey, metadataStoreName, openOfflineRetailDatabase, permitStoreName } from './offlineRetailDatabase'

type ServerStatus = 'AVAILABLE' | 'CONSUMED_CONFLICT_PENDING' | 'CONSUMED_ACCEPTED'
type Permit = { permitId: string; sequence: number; status: ServerStatus }
export type AuthoritySnapshot = { authorityId: string; authorityVersion: number; terminalId: string; terminalKeyVersion: number; userId: string; locationId: string; issuedAt: string; expiresAt: string; currencyCode: string; currencyExponent: number; permitCount: number; productPrices: Array<{ productId: string; unitPriceMinor: number }> }
type AuthorityRecord = { snapshot: AuthoritySnapshot; knownRevoked: boolean }
type PermitRecord = { authorityId: string; permitId: string; sequence: number; serverStatus: ServerStatus; localState: 'AVAILABLE' | 'RESERVED'; operationId?: string }
type Metadata = { version: 1; terminalId: string; locationId: string; authorityIds: string[]; lastObservedMs: number; knownTerminalUnsafe: boolean }
type IdentityMarker = { terminalId?: unknown; locationId?: unknown; currentKeyVersion?: unknown; publicKey?: unknown; pending?: unknown; offlineStateEverInstalled?: unknown; [key: string]: unknown }
type State = { identity: IdentityMarker | undefined; meta: Metadata | undefined; authorities: AuthorityRecord[]; permits: PermitRecord[] }
export class OfflineAuthorityError extends Error {}

const validId = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0
const integer = (value: unknown, minimum: number): value is number => Number.isSafeInteger(value) && (value as number) >= minimum
const fail = (message: string): never => { throw new OfflineAuthorityError(message) }
const time = (value: unknown): number => {
  if (typeof value !== 'string') return fail('Authority timestamp is invalid.')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) return fail('Authority timestamp is invalid.')
  return parsed.getTime()
}
const status = (value: unknown): value is ServerStatus => value === 'AVAILABLE' || value === 'CONSUMED_CONFLICT_PENDING' || value === 'CONSUMED_ACCEPTED'

function snapshot(raw: unknown): { value: AuthoritySnapshot; revoked: boolean; permits: Permit[] } {
  if (!raw || typeof raw !== 'object') return fail('Authority response is invalid.')
  const x = raw as Record<string, unknown>
  const names = ['authorityId', 'terminalId', 'userId', 'locationId'] as const
  if (names.some(name => !validId(x[name])) || !integer(x.authorityVersion, 1) || !integer(x.terminalKeyVersion, 1) || !integer(x.permitCount, 1) || typeof x.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(x.currencyCode) || !integer(x.currencyExponent, 0) || (x.currencyExponent as number) > 9 || typeof x.revoked !== 'boolean') return fail('Authority response is invalid.')
  if (time(x.issuedAt) >= time(x.expiresAt)) return fail('Authority expiry is invalid.')
  if (!Array.isArray(x.productPrices) || !x.productPrices.length || !Array.isArray(x.permits)) return fail('Authority evidence is incomplete.')
  const products = x.productPrices.map((item: unknown) => {
    const p = item as Record<string, unknown>
    if (!p || !validId(p.productId) || !integer(p.unitPriceMinor, 1)) return fail('Authority product price is invalid.')
    return { productId: p.productId, unitPriceMinor: p.unitPriceMinor }
  }).sort((a, b) => a.productId.localeCompare(b.productId))
  if (new Set(products.map(p => p.productId)).size !== products.length) return fail('Authority product price is duplicated.')
  if (x.revoked && (!x.revocation || typeof x.revocation !== 'object' || !validId((x.revocation as Record<string, unknown>).revokedByUserId) || !validId((x.revocation as Record<string, unknown>).reason))) return fail('Authority revocation evidence is invalid.')
  if (x.revoked) time((x.revocation as Record<string, unknown>).revokedAt)
  if (!x.revoked && x.revocation !== undefined) return fail('Authority revocation evidence is inconsistent.')
  const value: AuthoritySnapshot = { authorityId: x.authorityId as string, authorityVersion: x.authorityVersion as number, terminalId: x.terminalId as string, terminalKeyVersion: x.terminalKeyVersion as number, userId: x.userId as string, locationId: x.locationId as string, issuedAt: x.issuedAt as string, expiresAt: x.expiresAt as string, currencyCode: x.currencyCode, currencyExponent: x.currencyExponent as number, permitCount: x.permitCount as number, productPrices: products }
  const listed = permits(x.permits, value.permitCount)
  const counts = x.permitCounts as Record<string, unknown> | undefined
  if (!counts || !integer(counts.available, 0) || !integer(counts.conflictPending, 0) || !integer(counts.accepted, 0) || counts.available !== listed.filter(p => p.status === 'AVAILABLE').length || counts.conflictPending !== listed.filter(p => p.status === 'CONSUMED_CONFLICT_PENDING').length || counts.accepted !== listed.filter(p => p.status === 'CONSUMED_ACCEPTED').length) return fail('Authority permit counts are inconsistent.')
  return { value, revoked: x.revoked, permits: listed }
}
function permits(raw: unknown, count: number): Permit[] {
  if (!Array.isArray(raw) || raw.length !== count) return fail('Authority permit set is incomplete.')
  const result = raw.map((item: unknown) => {
    const p = item as Record<string, unknown>
    if (!p || !validId(p.permitId) || !integer(p.sequence, 0) || !status(p.status)) return fail('Authority permit is invalid.')
    return { permitId: p.permitId, sequence: p.sequence, status: p.status }
  }).sort((a, b) => a.sequence - b.sequence)
  if (new Set(result.map(p => p.permitId)).size !== count || result.some((p, i) => p.sequence !== i)) return fail('Authority permit identities are inconsistent.')
  return result
}
function samePermits(a: Permit[], b: Permit[]): boolean { return JSON.stringify(a) === JSON.stringify(b) }

function stateTransaction<T>(db: IDBDatabase, mode: IDBTransactionMode, decide: (state: State, tx: IDBTransaction) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([identityStoreName, authorityStoreName, permitStoreName, metadataStoreName], mode)
    const requests = [tx.objectStore(identityStoreName).get(identityRecordKey), tx.objectStore(metadataStoreName).get(metadataRecordKey), tx.objectStore(authorityStoreName).getAll(), tx.objectStore(permitStoreName).getAll()]
    let remaining = requests.length, result: T, failure: unknown
    requests.forEach(request => { request.onsuccess = () => {
      if (--remaining) return
      try { result = decide({ identity: requests[0]!.result as IdentityMarker | undefined, meta: requests[1]!.result as Metadata | undefined, authorities: requests[2]!.result as AuthorityRecord[], permits: requests[3]!.result as PermitRecord[] }, tx) }
      catch (error) { failure = error; tx.abort() }
    } })
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure ?? new OfflineAuthorityError('Offline storage transaction failed.'))
    tx.onerror = () => reject(new OfflineAuthorityError('Offline storage transaction failed.', { cause: tx.error }))
  })
}
async function inDatabase<T>(mode: IDBTransactionMode, decide: (state: State, tx: IDBTransaction) => T): Promise<T> {
  const db = await openOfflineRetailDatabase()
  try { return await stateTransaction(db, mode, decide) } finally { db.close() }
}
function checked(state: State, terminal: TerminalIdentity): Metadata | undefined {
  const { identity, meta, authorities, permits: ledger } = state
  if (!identity || identity.terminalId !== terminal.terminalId || identity.locationId !== terminal.locationId || identity.publicKey !== terminal.publicKey || identity.currentKeyVersion !== terminal.currentKeyVersion) return fail('Terminal identity changed.')
  if (!meta) {
    if (identity.offlineStateEverInstalled !== undefined || authorities.length || ledger.length) return fail('OFFLINE_STATE_LOST')
    return undefined
  }
  if (identity.offlineStateEverInstalled !== true || meta.version !== 1 || meta.terminalId !== terminal.terminalId || meta.locationId !== terminal.locationId || !Array.isArray(meta.authorityIds) || !meta.authorityIds.length || !integer(meta.lastObservedMs, 0) || typeof meta.knownTerminalUnsafe !== 'boolean') return fail('OFFLINE_STATE_LOST')
  const ids = new Set(meta.authorityIds)
  if (ids.size !== meta.authorityIds.length || authorities.length !== ids.size || authorities.some(record => !record || !ids.has(record.snapshot?.authorityId))) return fail('OFFLINE_STATE_LOST')
  const permitIds = new Set<string>()
  const operationIds = new Set<string>()
  for (const record of authorities) {
    const x = record.snapshot
    if (!x || !validId(x.authorityId) || !validId(x.userId) || x.terminalId !== terminal.terminalId || x.locationId !== terminal.locationId || !integer(x.authorityVersion, 1) || !integer(x.terminalKeyVersion, 1) || x.terminalKeyVersion > terminal.currentKeyVersion! || !integer(x.permitCount, 1) || !/^[A-Z]{3}$/.test(x.currencyCode) || !integer(x.currencyExponent, 0) || x.currencyExponent > 9 || time(x.issuedAt) >= time(x.expiresAt) || typeof record.knownRevoked !== 'boolean' || !Array.isArray(x.productPrices) || !x.productPrices.length) return fail('OFFLINE_STATE_LOST')
    const products = new Set<string>()
    for (const p of x.productPrices) { if (!p || !validId(p.productId) || !integer(p.unitPriceMinor, 1) || products.has(p.productId)) return fail('OFFLINE_STATE_LOST'); products.add(p.productId) }
    const own = ledger.filter(p => p?.authorityId === x.authorityId).sort((a, b) => a.sequence - b.sequence)
    if (own.length !== x.permitCount) return fail('OFFLINE_STATE_LOST')
    for (let i = 0; i < own.length; i++) {
      const p = own[i]!
      if (!validId(p.permitId) || permitIds.has(p.permitId) || p.sequence !== i || !status(p.serverStatus) || (p.localState !== 'AVAILABLE' && p.localState !== 'RESERVED') || (p.localState === 'RESERVED' ? !validId(p.operationId) : p.operationId !== undefined)) return fail('OFFLINE_STATE_LOST')
      if (p.operationId) { if (operationIds.has(p.operationId)) return fail('OFFLINE_STATE_LOST'); operationIds.add(p.operationId) }
      permitIds.add(p.permitId)
    }
  }
  if (ledger.length !== authorities.reduce((n, a) => n + a.snapshot.permitCount, 0)) return fail('OFFLINE_STATE_LOST')
  return meta
}
async function terminalFor(locationId: string, allowPendingRetry = false): Promise<TerminalIdentity> {
  if (!validId(locationId)) return fail('Location is invalid.')
  const value = await loadTerminalIdentity()
  const pending = await loadPendingTerminalOperation()
  if (!value || value.state !== 'ENROLLED' || value.locationId !== locationId || (pending && !allowPendingRetry)) return fail('Terminal identity is not usable.')
  return value
}

export async function installOfflineAuthority(locationId: string, authorityId: string, expectedUserId: string): Promise<AuthoritySnapshot> {
  if (!validId(authorityId) || !validId(expectedUserId)) return fail('Authority installation input is invalid.')
  const terminal = await terminalFor(locationId)
  if (!await inDatabase('readonly', state => { checked(state, terminal); return true })) return fail('Offline storage is unavailable.')
  const terminalState = await reconcileTerminal(locationId)
  if (terminalState !== 'ENROLLED') {
    if (terminalState === 'REVOKED' || terminalState === 'SERVER_MISMATCH') await inDatabase('readwrite', (state, tx) => {
      const meta = checked(state, terminal)
      if (meta) tx.objectStore(metadataStoreName).put({ ...meta, knownTerminalUnsafe: true } satisfies Metadata, metadataRecordKey)
    })
    return fail('Terminal server state is not usable.')
  }
  const root = `/api/v1/retail/locations/${encodeURIComponent(locationId)}/offline-authorities/${encodeURIComponent(authorityId)}`
  const detail = await requestJson<{ authority: unknown }>(root)
  const separate = await requestJson<{ permits: unknown }>(`${root}/permits`)
  const parsed = snapshot(detail?.authority)
  const fresh = permits(separate?.permits, parsed.value.permitCount)
  if (!samePermits(parsed.permits, fresh) || parsed.value.authorityId !== authorityId || parsed.value.locationId !== locationId || parsed.value.terminalId !== terminal.terminalId || parsed.value.userId !== expectedUserId || parsed.value.terminalKeyVersion > terminal.currentKeyVersion!) return fail('Authority binding or permit evidence is invalid.')
  return inDatabase('readwrite', (state, tx) => {
    const prior = checked(state, terminal)
    const existing = state.authorities.find(a => a.snapshot.authorityId === authorityId)
    if (existing) {
      if (!prior) return fail('OFFLINE_STATE_LOST')
      if (JSON.stringify(existing.snapshot) !== JSON.stringify(parsed.value)) return fail('Authority immutable snapshot changed.')
      const local = state.permits.filter(p => p.authorityId === authorityId).sort((a, b) => a.sequence - b.sequence)
      if (local.some((p, i) => p.permitId !== fresh[i]!.permitId)) return fail('Authority permit identity changed.')
      if (parsed.revoked && !existing.knownRevoked) tx.objectStore(authorityStoreName).put({ ...existing, knownRevoked: true }, authorityId)
      for (let i = 0; i < local.length; i++) if (fresh[i]!.status !== 'AVAILABLE' && local[i]!.serverStatus === 'AVAILABLE') tx.objectStore(permitStoreName).put({ ...local[i], serverStatus: fresh[i]!.status }, [authorityId, i])
      tx.objectStore(metadataStoreName).put({ ...prior, lastObservedMs: Math.max(prior.lastObservedMs, Date.now()) } satisfies Metadata, metadataRecordKey)
      return existing.snapshot
    }
    if (parsed.revoked || fresh.some(p => p.status !== 'AVAILABLE') || fresh.some(p => state.permits.some(existingPermit => existingPermit.permitId === p.permitId))) return fail('Revoked Authority or invalid server permits cannot be newly installed.')
    const now = Date.now()
    if (now < time(parsed.value.issuedAt) || now >= time(parsed.value.expiresAt) || (prior && now < prior.lastObservedMs)) return fail('Authority local time is not eligible.')
    if (prior?.knownTerminalUnsafe) return fail('Terminal is known unsafe.')
    const meta: Metadata = prior ? { ...prior, authorityIds: [...prior.authorityIds, authorityId].sort(), lastObservedMs: now } : { version: 1, terminalId: terminal.terminalId!, locationId, authorityIds: [authorityId], lastObservedMs: now, knownTerminalUnsafe: false }
    tx.objectStore(identityStoreName).put({ ...state.identity, offlineStateEverInstalled: true }, identityRecordKey)
    tx.objectStore(authorityStoreName).put({ snapshot: parsed.value, knownRevoked: false } satisfies AuthorityRecord, authorityId)
    fresh.forEach(p => tx.objectStore(permitStoreName).put({ authorityId, permitId: p.permitId, sequence: p.sequence, serverStatus: p.status, localState: 'AVAILABLE' } satisfies PermitRecord, [authorityId, p.sequence]))
    tx.objectStore(metadataStoreName).put(meta, metadataRecordKey)
    return parsed.value
  })
}

export async function loadOfflineAuthority(locationId: string, authorityId: string): Promise<AuthoritySnapshot | undefined> {
  const terminal = await terminalFor(locationId)
  return inDatabase('readonly', state => { checked(state, terminal); return state.authorities.find(a => a.snapshot.authorityId === authorityId)?.snapshot })
}
export async function getAuthorizedProduct(locationId: string, authorityId: string, productId: string): Promise<{ productId: string; unitPriceMinor: number } | undefined> {
  if (!validId(productId)) return fail('Product is invalid.')
  return (await loadOfflineAuthority(locationId, authorityId))?.productPrices.find(p => p.productId === productId)
}
export type ReservedPermit = { authorityId: string; permitId: string; sequence: number; operationId: string }
async function reserveForUser(locationId: string, authorityId: string, operationId: string, userId: string | undefined): Promise<ReservedPermit> {
  if (!validId(authorityId) || !validId(operationId) || !validId(userId)) return fail('A proven current user and stable operation are required.')
  const terminal = await terminalFor(locationId, true)
  return inDatabase('readwrite', (state, tx) => {
    const meta = checked(state, terminal)
    if (!meta) return fail('Authority is not installed.')
    if (meta.knownTerminalUnsafe) return fail('Terminal is known unsafe.')
    const authority = state.authorities.find(a => a.snapshot.authorityId === authorityId)
    if (!authority || authority.snapshot.userId !== userId) return fail('Authority is not eligible for this user.')
    const prior = state.permits.find(p => p.localState === 'RESERVED' && p.operationId === operationId)
    if (prior) {
      if (prior.authorityId !== authorityId) return fail('Operation is bound to another Authority.')
      return { authorityId, permitId: prior.permitId, sequence: prior.sequence, operationId }
    }
    if (state.identity?.pending !== undefined) return fail('Terminal provisioning is pending.')
    if (authority.knownRevoked) return fail('Authority is known revoked.')
    // Historical authorities remain cached after rotation, but a new operation cannot be signed with a discarded historical private key.
    if (authority.snapshot.terminalKeyVersion !== terminal.currentKeyVersion) return fail('Authority signing key is unavailable for new work.')
    const now = Date.now()
    if (now < meta.lastObservedMs || now < time(authority.snapshot.issuedAt) || now >= time(authority.snapshot.expiresAt)) return fail('Authority local time is not eligible.')
    const next = state.permits.filter(p => p.authorityId === authorityId && p.localState === 'AVAILABLE' && p.serverStatus === 'AVAILABLE').sort((a, b) => a.sequence - b.sequence)[0]
    if (!next) return fail('Authority permits are exhausted.')
    tx.objectStore(permitStoreName).put({ ...next, localState: 'RESERVED', operationId } satisfies PermitRecord, [authorityId, next.sequence])
    tx.objectStore(metadataStoreName).put({ ...meta, lastObservedMs: now } satisfies Metadata, metadataRecordKey)
    return { authorityId, permitId: next.permitId, sequence: next.sequence, operationId }
  })
}
// The production entry point reads the existing AuthProvider, not a second offline user store.
export function useReserveOfflinePermit() {
  const auth = useAuth()
  const current = useRef(auth)
  current.current = auth
  return (locationId: string, authorityId: string, operationId: string) => {
    const state = current.current
    return reserveForUser(locationId, authorityId, operationId, !state.isLoading && !state.error ? state.user?.id : undefined)
  }
}
