import { useRef } from 'react'
import { canonicalizeRetailOfflineEnvelope, RETAIL_OFFLINE_SIGNATURE_PREFIX, type RetailOfflineEnvelope } from '@madina/retail'
import type { AuthContextValue } from '../../context/AuthContext'
import { getCurrentUser } from '../api/authApi'
import { HttpError, requestJson } from '../api/httpClient'
import { getRetailLocation, getRetailOfflineAuthorities, getRetailOfflineTerminalDetail, type RetailOfflineAuthoritySummary } from '../api/retailApi'
import { canRetail } from '../auth/retailPermissions'
import { useAuth } from '../../context/useAuth'
import { reconcileTerminal } from './terminalProvisioning'
import { inspectStoredTerminalIdentity, loadPendingTerminalOperation, loadTerminalIdentity, TerminalIdentityError, type TerminalIdentity } from './terminalIdentity'
import { authorityStoreName, identityRecordKey, identityStoreName, metadataRecordKey, metadataStoreName, offlineRetailDatabaseName, openOfflineRetailDatabase, permitStoreName, saleStoreName, syncStoreName } from './offlineRetailDatabase'

export type ServerStatus = 'AVAILABLE' | 'CONSUMED_CONFLICT_PENDING' | 'CONSUMED_ACCEPTED'
type Permit = { permitId: string; sequence: number; status: ServerStatus }
export type AuthoritySnapshot = { authorityId: string; authorityVersion: number; terminalId: string; terminalKeyVersion: number; userId: string; locationId: string; issuedAt: string; expiresAt: string; currencyCode: string; currencyExponent: number; permitCount: number; productPrices: Array<{ productId: string; unitPriceMinor: number }> }
export type AuthorityRecord = { snapshot: AuthoritySnapshot; knownRevoked: boolean }
export type PermitRecord = { authorityId: string; permitId: string; sequence: number; serverStatus: ServerStatus; localState: 'AVAILABLE' | 'RESERVED' | 'CONSUMED_LOCAL'; operationId?: string; saleId?: string }
export type TerminalSyncOutcome = { operationId: string; kind: 'ACCEPTED' | 'STOCK_CONFLICT' | 'HARD_REJECTED' }
export type Metadata = { version: 1; terminalId: string; locationId: string; authorityIds: string[]; lastObservedMs: number; knownTerminalUnsafe: boolean; saleOperationIds?: string[]; terminalSyncOutcomes?: TerminalSyncOutcome[] }
export type IdentityMarker = { terminalId?: unknown; locationId?: unknown; currentKeyVersion?: unknown; publicKey?: unknown; pending?: unknown; offlineStateEverInstalled?: unknown; offlineSaleEverPrepared?: unknown; offlineSyncEverTerminal?: unknown; [key: string]: unknown }
export type OfflineSaleRecord = { state: 'PREPARED'; intent: { authorityId: string; lines: Array<{ productId: string; quantity: number }> }; envelope: RetailOfflineEnvelope; publicKey: string; authoritySnapshot: AuthoritySnapshot } | { state: 'COMMITTED_LOCAL'; intent: { authorityId: string; lines: Array<{ productId: string; quantity: number }> }; envelope: RetailOfflineEnvelope; publicKey: string; authoritySnapshot: AuthoritySnapshot; canonicalPayload: string; payloadHash: string; signature: string; committedAt: string }
export type OfflineSyncRecord = { operationId: string; canonicalPayload: string; payloadHash: string; signature: string; publicKey: string; attemptCount: number; lastAttemptAt: number; nextAttemptAt: number; kind: 'RETRY_WAIT' | 'AUTH_HOLD' | 'ACCESS_HOLD' | 'REVIEW_HOLD' | 'ACCEPTED' | 'STOCK_CONFLICT' | 'HARD_REJECTED'; lastStatus?: number; lastMessage?: string; clientObservedAt?: string; serverSaleId?: string; conflictIncidentIds?: string[] }
export type State = { identity: IdentityMarker | undefined; meta: Metadata | undefined; authorities: AuthorityRecord[]; permits: PermitRecord[]; sales: OfflineSaleRecord[]; saleKeys: IDBValidKey[]; sync: OfflineSyncRecord[]; syncKeys: IDBValidKey[] }
export class OfflineAuthorityError extends Error {}

export type InstallableOfflineAuthority = { authorityId: string; expiresAt: string; terminalId: string; terminalKeyVersion: number; availablePermitCount: number }
export type InstallableOfflineAuthorityResult =
  | { status: 'OK'; authorities: InstallableOfflineAuthority[] }
  | { status: 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'IDENTITY_MISSING' | 'IDENTITY_INVALID' | 'LOCAL_STATE_INVALID' | 'SERVER_UNAVAILABLE' | 'SERVER_DATA_INVALID'; authorities: [] }
type DiscoverySession = Pick<AuthContextValue, 'user' | 'isLoading' | 'error'>

export const validId = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0
export const integer = (value: unknown, minimum: number): value is number => Number.isSafeInteger(value) && (value as number) >= minimum
const fail = (message: string): never => { throw new OfflineAuthorityError(message) }
export const time = (value: unknown): number => {
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

/** Validate both existing server reads without installing or refreshing local state. */
export function inspectServerOfflineAuthority(detail: unknown, separatePermits: unknown): { snapshot: AuthoritySnapshot; revoked: boolean; permits: Permit[] } {
  const parsed = snapshot(detail)
  const fresh = permits(separatePermits, parsed.value.permitCount)
  if (!samePermits(parsed.permits, fresh)) return fail('Authority permit evidence is inconsistent.')
  return { snapshot: parsed.value, revoked: parsed.revoked, permits: fresh }
}

type ValidatedServerAuthority = ReturnType<typeof inspectServerOfflineAuthority>
class TerminalServerStateError extends OfflineAuthorityError {
  readonly state: Awaited<ReturnType<typeof reconcileTerminal>>
  constructor(state: Awaited<ReturnType<typeof reconcileTerminal>>) { super('Terminal server state is not usable.'); this.state = state }
}

/** Shared Authority evidence and browser binding check; terminal preflight is owned by each caller. */
async function fetchValidatedAuthority(locationId: string, authorityId: string, userId: string, terminal: TerminalIdentity): Promise<ValidatedServerAuthority> {
  const root = `/api/v1/retail/locations/${encodeURIComponent(locationId)}/offline-authorities/${encodeURIComponent(authorityId)}`
  const detail = await requestJson<{ authority: unknown }>(root)
  const separate = await requestJson<{ permits: unknown }>(`${root}/permits`)
  const parsed = inspectServerOfflineAuthority(detail?.authority, separate?.permits)
  if (parsed.snapshot.authorityId !== authorityId || parsed.snapshot.locationId !== locationId || parsed.snapshot.terminalId !== terminal.terminalId || parsed.snapshot.userId !== userId || parsed.snapshot.terminalKeyVersion > terminal.currentKeyVersion!) return fail('Authority binding or permit evidence is invalid.')
  return parsed
}

/** Existing new-install policy. The candidate path adds current-key/currency checks separately. */
function newInstallEligible(state: State, prior: Metadata | undefined, terminal: TerminalIdentity, parsed: ValidatedServerAuthority, now: number): boolean {
  return !parsed.revoked && parsed.permits.every(permit => permit.status === 'AVAILABLE')
    && parsed.permits.every(permit => !state.permits.some(existing => existing.permitId === permit.permitId))
    && now >= time(parsed.snapshot.issuedAt) && now < time(parsed.snapshot.expiresAt)
    && (!prior || now >= prior.lastObservedMs) && !prior?.knownTerminalUnsafe
    && parsed.snapshot.terminalKeyVersion <= terminal.currentKeyVersion!
}

function sameSummary(summary: RetailOfflineAuthoritySummary, parsed: ValidatedServerAuthority): boolean {
  const value = parsed.snapshot
  return summary.authorityId === value.authorityId && summary.authorityVersion === value.authorityVersion
    && summary.terminalId === value.terminalId && summary.terminalKeyVersion === value.terminalKeyVersion
    && summary.userId === value.userId && summary.locationId === value.locationId
    && summary.issuedAt === value.issuedAt && summary.expiresAt === value.expiresAt
    && summary.currencyCode === value.currencyCode && summary.currencyExponent === value.currencyExponent
    && summary.permitCount === value.permitCount
}

/** Abort upgrades, including creation of an absent profile. */
function openExistingOfflineDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineRetailDatabaseName)
    let absent = false
    request.onupgradeneeded = event => { absent = (event as IDBVersionChangeEvent).oldVersion === 0; request.transaction!.abort() }
    request.onerror = () => absent ? resolve(undefined) : reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is blocked.'))
    request.onsuccess = () => resolve(request.result)
  })
}

type DiscoveryLocal = { state: State; terminal: TerminalIdentity; meta: Metadata | undefined }
async function readDiscoveryLocal(): Promise<DiscoveryLocal | 'IDENTITY_MISSING'> {
  const db = await openExistingOfflineDatabase()
  if (!db) return 'IDENTITY_MISSING'
  try {
    const stores = [authorityStoreName, identityStoreName, metadataStoreName, permitStoreName, saleStoreName, syncStoreName]
    if (db.version !== 4 || Array.from(db.objectStoreNames).sort().join('|') !== stores.sort().join('|')) throw new OfflineAuthorityError('Offline storage schema is invalid.')
    const state = await readOfflineStateSnapshot(db)
    const inspected = await inspectStoredTerminalIdentity(state.identity)
    if (!inspected) {
      if (state.meta || state.authorities.length || state.permits.length || state.sales.length || state.saleKeys.length || state.sync.length || state.syncKeys.length) throw new OfflineAuthorityError('Offline state exists without identity.')
      return 'IDENTITY_MISSING'
    }
    if (inspected.terminal.state !== 'ENROLLED' || inspected.pending) throw new OfflineAuthorityError('Terminal is not ready for Authority installation.')
    return { state, terminal: inspected.terminal, meta: checked(state, inspected.terminal) }
  } finally { db.close() }
}

const discoveryFailure = (status: Exclude<InstallableOfflineAuthorityResult['status'], 'OK'>): InstallableOfflineAuthorityResult => ({ status, authorities: [] })
function onlineFailure(error: unknown): InstallableOfflineAuthorityResult {
  if (error instanceof HttpError && error.status === 401) return discoveryFailure('AUTH_REQUIRED')
  if (error instanceof HttpError && error.status === 403) return discoveryFailure('ACCESS_DENIED')
  return discoveryFailure(error instanceof HttpError || error instanceof TypeError ? 'SERVER_UNAVAILABLE' : 'SERVER_DATA_INVALID')
}

/** Online observation only; never creates a profile, installs an Authority, or reserves a permit. */
export async function listInstallableOfflineAuthorities(locationId: string, auth: DiscoverySession): Promise<InstallableOfflineAuthorityResult> {
  if (auth.isLoading || auth.error || !auth.user) return discoveryFailure('AUTH_REQUIRED')
  let userId: string
  let currencyCode: string
  let currencyExponent: number
  try {
    const principal = await getCurrentUser()
    if (!principal || principal.id !== auth.user.id) return discoveryFailure('AUTH_REQUIRED')
    if (!canRetail(principal, 'retail:offline-terminals:manage')) return discoveryFailure('ACCESS_DENIED')
    const location = await getRetailLocation(locationId)
    if (!location || location.id !== locationId || location.status !== 'active' || location.type !== 'store' || !location.currencyCode || !Number.isSafeInteger(location.currencyExponent)) return discoveryFailure('ACCESS_DENIED')
    userId = principal.id
    currencyCode = location.currencyCode
    currencyExponent = location.currencyExponent!
  } catch (error) { return onlineFailure(error) }
  let local: DiscoveryLocal | 'IDENTITY_MISSING'
  try { local = await readDiscoveryLocal() }
  catch (error) { return discoveryFailure(error instanceof TerminalIdentityError ? 'IDENTITY_INVALID' : 'LOCAL_STATE_INVALID') }
  if (local === 'IDENTITY_MISSING') return discoveryFailure('IDENTITY_MISSING')
  if (local.terminal.locationId !== locationId || local.meta?.knownTerminalUnsafe) return discoveryFailure('LOCAL_STATE_INVALID')
  // Only server reads follow the verified local snapshot. Never call a creating identity opener here.
  try {
    const terminal = await getRetailOfflineTerminalDetail(locationId, local.terminal.terminalId!)
    if (!terminal || terminal.terminalId !== local.terminal.terminalId || terminal.locationId !== locationId
      || !integer(terminal.currentKeyVersion, 1) || typeof terminal.revoked !== 'boolean') return discoveryFailure('SERVER_DATA_INVALID')
    if (terminal.revoked || terminal.currentKeyVersion !== local.terminal.currentKeyVersion) return discoveryFailure('LOCAL_STATE_INVALID')
  } catch (error) { return onlineFailure(error) }
  let summaries: RetailOfflineAuthoritySummary[]
  try { summaries = await getRetailOfflineAuthorities(locationId) }
  catch (error) { return onlineFailure(error) }
  const compatible: InstallableOfflineAuthority[] = []
  for (const summary of summaries) {
    if (summary.userId !== userId || summary.terminalId !== local.terminal.terminalId || summary.locationId !== locationId
      || summary.terminalKeyVersion !== local.terminal.currentKeyVersion || summary.revoked
      || summary.currencyCode !== currencyCode || summary.currencyExponent !== currencyExponent
      || local.state.authorities.some(item => item.snapshot.authorityId === summary.authorityId)) continue
    let parsed: ValidatedServerAuthority
    try { parsed = await fetchValidatedAuthority(locationId, summary.authorityId, userId, local.terminal) }
    catch (error) { return onlineFailure(error) }
    if (!sameSummary(summary, parsed)) return discoveryFailure('SERVER_DATA_INVALID')
    if (parsed.snapshot.terminalKeyVersion !== local.terminal.currentKeyVersion || parsed.revoked || parsed.snapshot.currencyCode !== currencyCode || parsed.snapshot.currencyExponent !== currencyExponent) continue
    if (newInstallEligible(local.state, local.meta, local.terminal, parsed, Date.now())) compatible.push({ authorityId: parsed.snapshot.authorityId, expiresAt: parsed.snapshot.expiresAt, terminalId: parsed.snapshot.terminalId, terminalKeyVersion: parsed.snapshot.terminalKeyVersion, availablePermitCount: parsed.permits.length })
  }
  return { status: 'OK', authorities: compatible.sort((a, b) => a.authorityId.localeCompare(b.authorityId)) }
}

function stateTransaction<T>(db: IDBDatabase, mode: IDBTransactionMode, decide: (state: State, tx: IDBTransaction) => T, legacy = false): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([identityStoreName, authorityStoreName, permitStoreName, metadataStoreName, saleStoreName, ...(!legacy ? [syncStoreName] : [])], mode)
    const requests = [tx.objectStore(identityStoreName).get(identityRecordKey), tx.objectStore(metadataStoreName).get(metadataRecordKey), tx.objectStore(authorityStoreName).getAll(), tx.objectStore(permitStoreName).getAll(), tx.objectStore(saleStoreName).getAll(), tx.objectStore(saleStoreName).getAllKeys(), ...(!legacy ? [tx.objectStore(syncStoreName).getAll(), tx.objectStore(syncStoreName).getAllKeys()] : [])]
    let remaining = requests.length, result: T, failure: unknown
    requests.forEach(request => { request.onsuccess = () => {
      if (--remaining) return
      try { result = decide({ identity: requests[0]!.result as IdentityMarker | undefined, meta: requests[1]!.result as Metadata | undefined, authorities: requests[2]!.result as AuthorityRecord[], permits: requests[3]!.result as PermitRecord[], sales: requests[4]!.result as OfflineSaleRecord[], saleKeys: requests[5]!.result as IDBValidKey[], sync: legacy ? [] : requests[6]!.result as OfflineSyncRecord[], syncKeys: legacy ? [] : requests[7]!.result as IDBValidKey[] }, tx) }
      catch (error) { failure = error; tx.abort() }
    } })
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure ?? new OfflineAuthorityError('Offline storage transaction failed.'))
    tx.onerror = () => reject(new OfflineAuthorityError('Offline storage transaction failed.', { cause: tx.error }))
  })
}
/** Read one immutable observation; callers validate it after the transaction completes. */
export function readOfflineStateSnapshot(db: IDBDatabase, legacy = false): Promise<State> {
  return stateTransaction(db, 'readonly', state => state, legacy)
}
export async function inDatabase<T>(mode: IDBTransactionMode, decide: (state: State, tx: IDBTransaction) => T): Promise<T> {
  const db = await openOfflineRetailDatabase()
  try { return await stateTransaction(db, mode, decide) } finally { db.close() }
}
export function checked(state: State, terminal?: TerminalIdentity): Metadata | undefined {
  const { identity, meta, authorities, permits: ledger, sales, saleKeys, sync, syncKeys } = state
  if (!identity || !validId(identity.terminalId) || !validId(identity.locationId) || !validId(identity.publicKey) || !integer(identity.currentKeyVersion, 1) || (terminal && (identity.terminalId !== terminal.terminalId || identity.locationId !== terminal.locationId || identity.publicKey !== terminal.publicKey || identity.currentKeyVersion !== terminal.currentKeyVersion))) return fail('Terminal identity changed.')
  if (!meta) {
    if (identity.offlineStateEverInstalled !== undefined || identity.offlineSaleEverPrepared !== undefined || identity.offlineSyncEverTerminal !== undefined || authorities.length || ledger.length || sales.length || sync.length) return fail('OFFLINE_STATE_LOST')
    return undefined
  }
  if (identity.offlineStateEverInstalled !== true || meta.version !== 1 || meta.terminalId !== identity.terminalId || meta.locationId !== identity.locationId || !Array.isArray(meta.authorityIds) || !meta.authorityIds.length || !integer(meta.lastObservedMs, 0) || typeof meta.knownTerminalUnsafe !== 'boolean') return fail('OFFLINE_STATE_LOST')
  const ids = new Set(meta.authorityIds)
  if (ids.size !== meta.authorityIds.length || authorities.length !== ids.size || authorities.some(record => !record || !ids.has(record.snapshot?.authorityId))) return fail('OFFLINE_STATE_LOST')
  const permitIds = new Set<string>()
  const operationIds = new Set<string>()
  for (const record of authorities) {
    const x = record.snapshot
    if (!x || !validId(x.authorityId) || !validId(x.userId) || x.terminalId !== identity.terminalId || x.locationId !== identity.locationId || !integer(x.authorityVersion, 1) || !integer(x.terminalKeyVersion, 1) || x.terminalKeyVersion > identity.currentKeyVersion || !integer(x.permitCount, 1) || !/^[A-Z]{3}$/.test(x.currencyCode) || !integer(x.currencyExponent, 0) || x.currencyExponent > 9 || time(x.issuedAt) >= time(x.expiresAt) || typeof record.knownRevoked !== 'boolean' || !Array.isArray(x.productPrices) || !x.productPrices.length) return fail('OFFLINE_STATE_LOST')
    const products = new Set<string>()
    for (const p of x.productPrices) { if (!p || !validId(p.productId) || !integer(p.unitPriceMinor, 1) || products.has(p.productId)) return fail('OFFLINE_STATE_LOST'); products.add(p.productId) }
    const own = ledger.filter(p => p?.authorityId === x.authorityId).sort((a, b) => a.sequence - b.sequence)
    if (own.length !== x.permitCount) return fail('OFFLINE_STATE_LOST')
    for (let i = 0; i < own.length; i++) {
      const p = own[i]!
      if (!validId(p.permitId) || permitIds.has(p.permitId) || p.sequence !== i || !status(p.serverStatus) || !['AVAILABLE', 'RESERVED', 'CONSUMED_LOCAL'].includes(p.localState) || (p.localState === 'AVAILABLE' ? p.operationId !== undefined || p.saleId !== undefined : !validId(p.operationId)) || (p.localState === 'CONSUMED_LOCAL' ? !validId(p.saleId) : p.saleId !== undefined)) return fail('OFFLINE_STATE_LOST')
      if (p.operationId) { if (operationIds.has(p.operationId)) return fail('OFFLINE_STATE_LOST'); operationIds.add(p.operationId) }
      permitIds.add(p.permitId)
    }
  }
  if (ledger.length !== authorities.reduce((n, a) => n + a.snapshot.permitCount, 0)) return fail('OFFLINE_STATE_LOST')
  if (identity.offlineSaleEverPrepared === true) {
    if (!Array.isArray(meta.saleOperationIds) || !meta.saleOperationIds.length || meta.saleOperationIds.length !== sales.length || new Set(meta.saleOperationIds).size !== sales.length || meta.saleOperationIds.some(id => !validId(id))) return fail('OFFLINE_STATE_LOST')
  } else if (identity.offlineSaleEverPrepared !== undefined || meta.saleOperationIds !== undefined || sales.length) return fail('OFFLINE_STATE_LOST')
  if (saleKeys.length !== sales.length) return fail('OFFLINE_STATE_LOST')
  for (const [index, sale] of sales.entries()) {
    if (!sale || (sale.state !== 'PREPARED' && sale.state !== 'COMMITTED_LOCAL') || !sale.envelope || saleKeys[index] !== sale.envelope.offlineOperationId || !meta.saleOperationIds?.includes(sale.envelope.offlineOperationId) || !validId(sale.publicKey) || !sale.authoritySnapshot || !sale.intent || sale.intent.authorityId !== sale.envelope.authorityId || !Array.isArray(sale.intent.lines) || sale.intent.lines.length !== sale.envelope.lines.length) return fail('OFFLINE_STATE_LOST')
    try { canonicalizeRetailOfflineEnvelope(sale.envelope) } catch { return fail('OFFLINE_STATE_LOST') }
    const authority = authorities.find(a => a.snapshot.authorityId === sale.envelope.authorityId)
    const permit = ledger.find(p => p.authorityId === sale.envelope.authorityId && p.permitId === sale.envelope.permitId)
    if (!authority || JSON.stringify(authority.snapshot) !== JSON.stringify(sale.authoritySnapshot) || sale.envelope.authorityVersion !== authority.snapshot.authorityVersion || sale.envelope.terminalId !== authority.snapshot.terminalId || sale.envelope.terminalKeyVersion !== authority.snapshot.terminalKeyVersion || sale.envelope.userId !== authority.snapshot.userId || sale.envelope.locationId !== authority.snapshot.locationId || sale.envelope.currencyCode !== authority.snapshot.currencyCode || sale.envelope.currencyExponent !== authority.snapshot.currencyExponent || sale.envelope.proposedSaleId !== sale.envelope.offlineOperationId || sale.intent.lines.some((line, index) => line.productId !== sale.envelope.lines[index]?.productId || line.quantity !== sale.envelope.lines[index]?.quantity || authority.snapshot.productPrices.find(price => price.productId === line.productId)?.unitPriceMinor !== sale.envelope.lines[index]?.unitPriceMinor) || !permit || permit.sequence !== sale.envelope.permitSequence || permit.operationId !== sale.envelope.offlineOperationId || permit.saleId !== (sale.state === 'COMMITTED_LOCAL' ? sale.envelope.proposedSaleId : undefined) || permit.localState !== (sale.state === 'COMMITTED_LOCAL' ? 'CONSUMED_LOCAL' : 'RESERVED')) return fail('OFFLINE_STATE_LOST')
    if (sale.state === 'COMMITTED_LOCAL' && (sale.canonicalPayload !== canonicalizeRetailOfflineEnvelope(sale.envelope) || !/^[a-f0-9]{64}$/.test(sale.payloadHash) || typeof sale.signature !== 'string' || !sale.signature.startsWith(RETAIL_OFFLINE_SIGNATURE_PREFIX))) return fail('OFFLINE_STATE_LOST')
  }
  for (const permit of ledger) if (permit.localState === 'CONSUMED_LOCAL' && !sales.some(sale => sale.state === 'COMMITTED_LOCAL' && sale.envelope.offlineOperationId === permit.operationId)) return fail('OFFLINE_STATE_LOST')
  const terminalKinds = new Set(['ACCEPTED', 'STOCK_CONFLICT', 'HARD_REJECTED'])
  const holdKinds = new Set(['RETRY_WAIT', 'AUTH_HOLD', 'ACCESS_HOLD', 'REVIEW_HOLD'])
  const terminalOutcomes = meta.terminalSyncOutcomes
  if (identity.offlineSyncEverTerminal === true) {
    if (!Array.isArray(terminalOutcomes) || !terminalOutcomes.length || new Set(terminalOutcomes.map(item => item?.operationId)).size !== terminalOutcomes.length || terminalOutcomes.some(item => !item || !validId(item.operationId) || !['ACCEPTED', 'STOCK_CONFLICT', 'HARD_REJECTED'].includes(item.kind))) return fail('OFFLINE_STATE_LOST')
  } else if (identity.offlineSyncEverTerminal !== undefined || terminalOutcomes !== undefined) return fail('OFFLINE_STATE_LOST')
  if (sync.length !== syncKeys.length) return fail('OFFLINE_STATE_LOST')
  for (const [index, record] of sync.entries()) {
    const sale = sales.find(item => item.envelope.offlineOperationId === record?.operationId)
    if (!record || syncKeys[index] !== record.operationId || !sale || sale.state !== 'COMMITTED_LOCAL' || record.canonicalPayload !== sale.canonicalPayload || record.payloadHash !== sale.payloadHash || record.signature !== sale.signature || record.publicKey !== sale.publicKey || !integer(record.attemptCount, 0) || !integer(record.lastAttemptAt, 0) || !integer(record.nextAttemptAt, 0)) return fail('OFFLINE_STATE_LOST')
    const terminal = terminalKinds.has(record.kind)
    if (!terminal && !holdKinds.has(record.kind)) return fail('OFFLINE_STATE_LOST')
    const marker = terminalOutcomes?.find(item => item.operationId === record.operationId)
    if (terminal ? marker?.kind !== record.kind : marker !== undefined) return fail('OFFLINE_STATE_LOST')
    if (terminal && (!record.clientObservedAt || Number.isNaN(new Date(record.clientObservedAt).getTime()))) return fail('OFFLINE_STATE_LOST')
    if (!terminal && (record.clientObservedAt !== undefined || record.serverSaleId !== undefined || record.conflictIncidentIds !== undefined)) return fail('OFFLINE_STATE_LOST')
    if (record.kind === 'ACCEPTED' && ((record.lastStatus !== 200 && record.lastStatus !== 201) || record.serverSaleId !== sale.envelope.proposedSaleId || record.lastMessage !== undefined || record.conflictIncidentIds !== undefined)) return fail('OFFLINE_STATE_LOST')
    if (record.kind === 'STOCK_CONFLICT' && (record.lastStatus !== 409 || record.lastMessage !== 'VERIFIED_OFFLINE_STOCK_CONFLICT' || record.serverSaleId !== undefined || (record.conflictIncidentIds !== undefined && (!Array.isArray(record.conflictIncidentIds) || !record.conflictIncidentIds.length || new Set(record.conflictIncidentIds).size !== record.conflictIncidentIds.length || record.conflictIncidentIds.some(id => !sale.envelope.lines.some(line => line.id === id)))))) return fail('OFFLINE_STATE_LOST')
    if (record.kind === 'HARD_REJECTED' && ((record.lastStatus !== 400 && record.lastStatus !== 409) || typeof record.lastMessage !== 'string' || !(record.lastMessage === 'IDEMPOTENCY_CONFLICT' && record.lastStatus === 409 || record.lastMessage.startsWith('Retail Offline envelope ') || record.lastMessage.startsWith('Retail Offline Envelope ')) || record.serverSaleId !== undefined || record.conflictIncidentIds !== undefined)) return fail('OFFLINE_STATE_LOST')
  }
  if (terminalOutcomes?.some(item => !sync.some(record => record.operationId === item.operationId))) return fail('OFFLINE_STATE_LOST')
  return meta
}
export async function terminalFor(locationId: string, allowPendingRetry = false): Promise<TerminalIdentity> {
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
    throw new TerminalServerStateError(terminalState)
  }
  let parsed: ValidatedServerAuthority
  parsed = await fetchValidatedAuthority(locationId, authorityId, expectedUserId, terminal)
  const fresh = parsed.permits
  return inDatabase('readwrite', (state, tx) => {
    const prior = checked(state, terminal)
    const existing = state.authorities.find(a => a.snapshot.authorityId === authorityId)
    if (existing) {
      if (!prior) return fail('OFFLINE_STATE_LOST')
      if (JSON.stringify(existing.snapshot) !== JSON.stringify(parsed.snapshot)) return fail('Authority immutable snapshot changed.')
      const local = state.permits.filter(p => p.authorityId === authorityId).sort((a, b) => a.sequence - b.sequence)
      if (local.some((p, i) => p.permitId !== fresh[i]!.permitId)) return fail('Authority permit identity changed.')
      if (parsed.revoked && !existing.knownRevoked) tx.objectStore(authorityStoreName).put({ ...existing, knownRevoked: true }, authorityId)
      for (let i = 0; i < local.length; i++) if (fresh[i]!.status !== 'AVAILABLE' && local[i]!.serverStatus === 'AVAILABLE') tx.objectStore(permitStoreName).put({ ...local[i], serverStatus: fresh[i]!.status }, [authorityId, i])
      tx.objectStore(metadataStoreName).put({ ...prior, lastObservedMs: Math.max(prior.lastObservedMs, Date.now()) } satisfies Metadata, metadataRecordKey)
      return existing.snapshot
    }
    const now = Date.now()
    if (!newInstallEligible(state, prior, terminal, parsed, now)) return fail('Authority is not eligible for new installation.')
    const meta: Metadata = prior ? { ...prior, authorityIds: [...prior.authorityIds, authorityId].sort(), lastObservedMs: now } : { version: 1, terminalId: terminal.terminalId!, locationId, authorityIds: [authorityId], lastObservedMs: now, knownTerminalUnsafe: false }
    tx.objectStore(identityStoreName).put({ ...state.identity, offlineStateEverInstalled: true }, identityRecordKey)
    tx.objectStore(authorityStoreName).put({ snapshot: parsed.snapshot, knownRevoked: false } satisfies AuthorityRecord, authorityId)
    fresh.forEach(p => tx.objectStore(permitStoreName).put({ authorityId, permitId: p.permitId, sequence: p.sequence, serverStatus: p.status, localState: 'AVAILABLE' } satisfies PermitRecord, [authorityId, p.sequence]))
    tx.objectStore(metadataStoreName).put(meta, metadataRecordKey)
    return parsed.snapshot
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
export function eligibleForNew(state: State, meta: Metadata, terminal: TerminalIdentity, authorityId: string, userId: string): { authority: AuthorityRecord; now: number; permit: PermitRecord } {
  if (meta.knownTerminalUnsafe) return fail('Terminal is known unsafe.')
  const authority = state.authorities.find(a => a.snapshot.authorityId === authorityId)
  if (!authority || authority.snapshot.userId !== userId) return fail('Authority is not eligible for this user.')
  if (state.identity?.pending !== undefined) return fail('Terminal provisioning is pending.')
  if (authority.knownRevoked) return fail('Authority is known revoked.')
  if (authority.snapshot.terminalKeyVersion !== terminal.currentKeyVersion) return fail('Authority signing key is unavailable for new work.')
  const now = Date.now()
  if (now < meta.lastObservedMs || now < time(authority.snapshot.issuedAt) || now >= time(authority.snapshot.expiresAt)) return fail('Authority local time is not eligible.')
  const permit = state.permits.filter(p => p.authorityId === authorityId && p.localState === 'AVAILABLE' && p.serverStatus === 'AVAILABLE').sort((a, b) => a.sequence - b.sequence)[0]
  if (!permit) return fail('Authority permits are exhausted.')
  return { authority, now, permit }
}
async function reserveForUser(locationId: string, authorityId: string, operationId: string, userId: string | undefined): Promise<ReservedPermit> {
  if (!validId(authorityId) || !validId(operationId) || !validId(userId)) return fail('A proven current user and stable operation are required.')
  const terminal = await terminalFor(locationId, true)
  return inDatabase('readwrite', (state, tx) => {
    const meta = checked(state, terminal)
    if (!meta) return fail('Authority is not installed.')
    if (meta.knownTerminalUnsafe) return fail('Terminal is known unsafe.')
    const authority = state.authorities.find(a => a.snapshot.authorityId === authorityId)
    if (!authority || authority.snapshot.userId !== userId) return fail('Authority is not eligible for this user.')
    const prior = state.permits.find(p => p.operationId === operationId)
    if (prior) {
      if (prior.authorityId !== authorityId) return fail('Operation is bound to another Authority.')
      if (prior.localState !== 'RESERVED') return fail('Operation permit is already consumed locally.')
      return { authorityId, permitId: prior.permitId, sequence: prior.sequence, operationId }
    }
    const { now, permit: next } = eligibleForNew(state, meta, terminal, authorityId, userId)
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
