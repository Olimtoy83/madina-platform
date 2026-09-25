import type { AuthContextValue } from '../../context/AuthContext'
import { getCurrentUser } from '../api/authApi'
import { HttpError, requestJson } from '../api/httpClient'
import { getRetailLocation, getRetailOfflineAuthorityDetail, getRetailOfflineAuthorityPermits, getRetailOfflineTerminalDetail } from '../api/retailApi'
import { canRetail } from '../auth/retailPermissions'
import { inspectServerOfflineAuthority } from './offlineAuthorityLedger'
import { identityRecordKey, identityStoreName, offlineRetailDatabaseName, openOfflineRetailDatabase } from './offlineRetailDatabase'
import { loadPendingTerminalOperation, loadTerminalIdentity } from './terminalIdentity'

type Session = Pick<AuthContextValue, 'user' | 'isLoading' | 'error'>
type Command = { commandId: string; terminalId: string; userId: string; expiresAt: string; permitCount: number; productIds: string[] }
type Issued = { id: string; authorityVersion: number; terminalId: string; terminalKeyVersion: number; userId: string; locationId: string; issuedAt: string; expiresAt: string; currencyCode: string; currencyExponent: number; permitCount: number; revoked: boolean }
type Phase = 'PENDING' | 'AUTH_HOLD' | 'ACCESS_HOLD' | 'REVIEW_HOLD' | 'COMPLETED'
type Stored = { version: 1; state: Phase; locationId: string; expectedKeyVersion: number; command: Command; checksum: string; authorityId?: string }
type Marker = { authorityIssuanceExpected?: true; authorityIssuanceChecksum?: string; terminalId?: string; locationId?: string; currentKeyVersion?: number; pending?: unknown; [key: string]: unknown }
export type AuthorityIssuanceState = { state: 'NONE' | Phase; commandId?: string; locationId?: string; terminalId?: string; userId?: string; authorityId?: string }
export type AuthorityIssuanceInput = { locationId: string; expiresAt: string; permitCount: number; productIds: string[] }
export class AuthorityIssuanceIntegrityError extends Error {}

const commandKey = 'authority-issuance:current'
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const fail = (message: string): never => { throw new AuthorityIssuanceIntegrityError(message) }
const phases: Phase[] = ['PENDING', 'AUTH_HOLD', 'ACCESS_HOLD', 'REVIEW_HOLD', 'COMPLETED']
function iso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}
function products(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.some(item => !validId(item)) || new Set(raw).size !== raw.length) return fail('Authority product selection is invalid.')
  return [...raw as string[]].sort()
}
function canonical(value: Pick<Stored, 'locationId' | 'expectedKeyVersion' | 'command'>): string {
  return JSON.stringify({ locationId: value.locationId, expectedKeyVersion: value.expectedKeyVersion, command: value.command })
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
function shape(raw: unknown, marker: Marker | undefined): Stored | undefined {
  const expected = marker?.authorityIssuanceExpected
  if (expected !== undefined && expected !== true) return fail('Authority issuance marker is invalid.')
  if (raw === undefined && expected === undefined) return undefined
  if (!marker || expected !== true || typeof marker.authorityIssuanceChecksum !== 'string' || !raw || typeof raw !== 'object') return fail('Authority issuance state is missing.')
  const value = raw as Stored
  const c = value.command
  if (value.version !== 1 || !phases.includes(value.state) || !validId(value.locationId) || !positive(value.expectedKeyVersion) || !c || !validId(c.commandId) || !validId(c.terminalId) || !validId(c.userId) || !iso(c.expiresAt) || !positive(c.permitCount) || !Array.isArray(c.productIds) || !c.productIds.length || c.productIds.some(id => !validId(id)) || new Set(c.productIds).size !== c.productIds.length || JSON.stringify(c.productIds) !== JSON.stringify(products(c.productIds)) || !/^[a-f0-9]{64}$/.test(value.checksum) || value.checksum !== marker.authorityIssuanceChecksum || value.locationId !== marker.locationId || c.terminalId !== marker.terminalId || value.expectedKeyVersion !== marker.currentKeyVersion || (value.state === 'COMPLETED' ? !validId(value.authorityId) : value.authorityId !== undefined)) return fail('Authority issuance state is inconsistent.')
  return value
}
async function validated(raw: unknown, marker: Marker | undefined): Promise<Stored | undefined> {
  const value = shape(raw, marker)
  if (value && await digest(canonical(value)) !== value.checksum) return fail('Authority issuance payload changed.')
  return value
}
function publicState(value: Stored | undefined): AuthorityIssuanceState {
  return value ? { state: value.state, commandId: value.command.commandId, locationId: value.locationId, terminalId: value.command.terminalId, userId: value.command.userId, ...(value.authorityId ? { authorityId: value.authorityId } : {}) } : { state: 'NONE' }
}
function readPair(db: IDBDatabase): Promise<{ marker?: Marker; raw?: unknown }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(identityStoreName, 'readonly')
    const store = tx.objectStore(identityStoreName)
    const current = store.get(identityRecordKey), command = store.get(commandKey)
    tx.oncomplete = () => resolve({ marker: current.result as Marker | undefined, raw: command.result })
    tx.onabort = () => reject(tx.error ?? new Error('Authority issuance read failed.'))
    tx.onerror = () => reject(tx.error ?? new Error('Authority issuance read failed.'))
  })
}
function openExisting(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineRetailDatabaseName)
    let absent = false
    request.onupgradeneeded = event => { absent = (event as IDBVersionChangeEvent).oldVersion === 0; request.transaction!.abort() }
    request.onerror = () => absent ? resolve(undefined) : reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is blocked.'))
    request.onsuccess = () => resolve(request.result)
  })
}
/** Observational: an absent profile remains absent. */
export async function getAuthorityIssuanceState(): Promise<AuthorityIssuanceState> {
  const db = await openExisting()
  if (!db) return { state: 'NONE' }
  try {
    if (db.version !== 4 || !db.objectStoreNames.contains(identityStoreName)) return fail('Authority issuance storage schema is invalid.')
    const pair = await readPair(db)
    return publicState(await validated(pair.raw, pair.marker))
  } finally { db.close() }
}
function change(db: IDBDatabase, decide: (current: Marker | undefined, existing: Stored | undefined, store: IDBObjectStore) => Stored): Promise<Stored> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(identityStoreName, 'readwrite')
    const store = tx.objectStore(identityStoreName)
    const current = store.get(identityRecordKey), command = store.get(commandKey)
    let result: Stored, failure: unknown, remaining = 2
    const ready = () => {
      if (--remaining) return
      try { result = decide(current.result as Marker | undefined, shape(command.result, current.result as Marker | undefined), store) }
      catch (error) { failure = error; tx.abort() }
    }
    current.onsuccess = ready
    command.onsuccess = ready
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Authority issuance write failed.'))
    tx.onerror = () => reject(tx.error ?? new Error('Authority issuance write failed.'))
  })
}
export function classifyAuthorityIssuanceError(error: unknown): Phase {
  if (error instanceof HttpError) {
    if (error.status === 401) return 'AUTH_HOLD'
    if (error.status === 403) return 'ACCESS_HOLD'
    if (error.status === 408 || error.status === 429 || error.status >= 500) return 'PENDING'
    return 'REVIEW_HOLD'
  }
  return error instanceof TypeError ? 'PENDING' : 'REVIEW_HOLD'
}
async function preflight(value: Stored, auth: Session): Promise<{ currencyCode: string; currencyExponent: number }> {
  if (auth.isLoading || auth.error || !auth.user) throw new HttpError(401, 'Authentication required.')
  if (auth.user.id !== value.command.userId) return fail('Authority issuance actor changed.')
  const principal = await getCurrentUser()
  if (principal.id !== value.command.userId) return fail('Authority issuance actor changed.')
  if (!canRetail(principal, 'retail:offline-terminals:manage')) throw new HttpError(403, 'Access denied.')
  const location = await getRetailLocation(value.locationId)
  if (!location || location.id !== value.locationId || location.status !== 'active' || location.type !== 'store' || !location.currencyCode || !Number.isSafeInteger(location.currencyExponent)) return fail('Authority issuance location changed.')
  const identity = await loadTerminalIdentity()
  if (!identity || identity.state !== 'ENROLLED' || identity.locationId !== value.locationId || identity.terminalId !== value.command.terminalId || identity.currentKeyVersion !== value.expectedKeyVersion || await loadPendingTerminalOperation()) return fail('Authority issuance terminal changed.')
  const terminal = await getRetailOfflineTerminalDetail(value.locationId, value.command.terminalId)
  if (!terminal || terminal.terminalId !== value.command.terminalId || terminal.locationId !== value.locationId || terminal.currentKeyVersion !== value.expectedKeyVersion || terminal.revoked !== false) return fail('Authority issuance terminal is unavailable.')
  return { currencyCode: location.currencyCode, currencyExponent: location.currencyExponent! }
}
async function setState(value: Stored, state: Phase, authorityId?: string): Promise<AuthorityIssuanceState> {
  const db = await openOfflineRetailDatabase()
  try {
    const next = await change(db, (current, existing, store) => {
      if (!current || !existing || existing.command.commandId !== value.command.commandId || existing.checksum !== value.checksum || canonical(existing) !== canonical(value)) return fail('Authority issuance changed during request.')
      if (existing.state === 'COMPLETED') return existing
      const updated: Stored = { ...existing, state, ...(state === 'COMPLETED' ? { authorityId } : {}) }
      store.put(updated, commandKey)
      return updated
    })
    return publicState(next)
  } finally { db.close() }
}
async function postStoredCommand(value: Stored): Promise<Issued> {
  const response = await requestJson<{ authority: Issued }>(
    `/api/v1/retail/locations/${encodeURIComponent(value.locationId)}/offline-authorities`,
    { method: 'POST', body: value.command },
  )
  return response.authority
}
async function execute(value: Stored, auth: Session): Promise<AuthorityIssuanceState> {
  if (value.state === 'COMPLETED' || value.state === 'REVIEW_HOLD') return publicState(value)
  let location: { currencyCode: string; currencyExponent: number }
  try { location = await preflight(value, auth) }
  catch (error) { return setState(value, classifyAuthorityIssuanceError(error)) }
  await setState(value, 'PENDING')
  let issued: Issued
  try { issued = await postStoredCommand(value) }
  catch (error) { return setState(value, classifyAuthorityIssuanceError(error)) }
  try {
    if (!issued || !validId(issued.id) || issued.terminalId !== value.command.terminalId || issued.userId !== value.command.userId || issued.locationId !== value.locationId || issued.terminalKeyVersion !== value.expectedKeyVersion || issued.expiresAt !== value.command.expiresAt || issued.permitCount !== value.command.permitCount || issued.currencyCode !== location.currencyCode || issued.currencyExponent !== location.currencyExponent || issued.revoked !== false || !positive(issued.authorityVersion) || !iso(issued.issuedAt)) return setState(value, 'REVIEW_HOLD')
    const parsed = inspectServerOfflineAuthority(await getRetailOfflineAuthorityDetail(value.locationId, issued.id), await getRetailOfflineAuthorityPermits(value.locationId, issued.id))
    const snapshot = parsed.snapshot
    if (parsed.revoked || snapshot.authorityId !== issued.id || snapshot.authorityVersion !== issued.authorityVersion || snapshot.terminalId !== value.command.terminalId || snapshot.terminalKeyVersion !== value.expectedKeyVersion || snapshot.userId !== value.command.userId || snapshot.locationId !== value.locationId || snapshot.issuedAt !== issued.issuedAt || snapshot.expiresAt !== value.command.expiresAt || snapshot.permitCount !== value.command.permitCount || snapshot.currencyCode !== location.currencyCode || snapshot.currencyExponent !== location.currencyExponent || JSON.stringify(snapshot.productPrices.map(item => item.productId).sort()) !== JSON.stringify(value.command.productIds) || parsed.permits.some(item => item.status !== 'AVAILABLE')) return setState(value, 'REVIEW_HOLD')
    await preflight(value, auth)
    return setState(value, 'COMPLETED', issued.id)
  } catch (error) { return setState(value, error instanceof HttpError || error instanceof TypeError ? classifyAuthorityIssuanceError(error) : 'REVIEW_HOLD') }
}
/** The only operation that may create a command; persistence completes before execute can POST. */
async function begin(input: AuthorityIssuanceInput, auth: Session, replaceCompletedCommandId?: string): Promise<AuthorityIssuanceState> {
  if (!input || !validId(input.locationId) || !iso(input.expiresAt) || new Date(input.expiresAt).getTime() <= Date.now() || !positive(input.permitCount)) return fail('Authority issuance input is invalid.')
  const productIds = products(input.productIds)
  const identity = await loadTerminalIdentity()
  if (!identity || identity.state !== 'ENROLLED' || !validId(identity.terminalId) || identity.locationId !== input.locationId || !positive(identity.currentKeyVersion)) return fail('Authority issuance requires an enrolled terminal.')
  if (auth.isLoading || auth.error || !auth.user || !validId(auth.user.id)) return { state: 'AUTH_HOLD' }
  const proposed: Stored = { version: 1, state: 'PENDING', locationId: input.locationId, expectedKeyVersion: identity.currentKeyVersion, command: { commandId: crypto.randomUUID(), terminalId: identity.terminalId, userId: auth.user.id, expiresAt: input.expiresAt, permitCount: input.permitCount, productIds }, checksum: '' }
  proposed.checksum = await digest(canonical(proposed))
  try { await preflight(proposed, auth) }
  catch (error) { return { state: classifyAuthorityIssuanceError(error) } }
  const db = await openOfflineRetailDatabase()
  try {
    const priorPair = await readPair(db)
    const prior = await validated(priorPair.raw, priorPair.marker)
    const created = await change(db, (current, existing, store) => {
      if (!current || current.terminalId !== proposed.command.terminalId || current.locationId !== proposed.locationId || current.currentKeyVersion !== proposed.expectedKeyVersion || current.pending !== undefined) return fail('Authority issuance profile changed.')
      if (replaceCompletedCommandId !== undefined) {
        if (!existing || !prior || existing.state !== 'COMPLETED' || prior.state !== 'COMPLETED' || existing.command.commandId !== replaceCompletedCommandId || prior.command.commandId !== replaceCompletedCommandId || !validId(existing.authorityId) || existing.authorityId !== prior.authorityId || prior.checksum !== existing.checksum || canonical(prior) !== canonical(existing)) return fail('Completed authority issuance is required.')
      } else if (existing) return existing
      store.put(proposed, commandKey)
      store.put({ ...current, authorityIssuanceExpected: true, authorityIssuanceChecksum: proposed.checksum }, identityRecordKey)
      return proposed
    })
    if (created.command.commandId !== proposed.command.commandId) return publicState(created)
    return execute(created, auth)
  } finally { db.close() }
}
export function beginAuthorityIssuance(input: AuthorityIssuanceInput, auth: Session): Promise<AuthorityIssuanceState> {
  return begin(input, auth)
}
/** An explicit new issuance after a known completion; never clears an ambiguous command. */
export async function beginRenewedAuthorityIssuance(completedCommandId: string, input: AuthorityIssuanceInput, auth: Session): Promise<AuthorityIssuanceState> {
  if (!validId(completedCommandId)) return fail('Completed command is required.')
  const completed = await getAuthorityIssuanceState()
  if (completed.state !== 'COMPLETED' || completed.commandId !== completedCommandId || !validId(completed.authorityId)) return fail('Verified completed authority issuance is required.')
  return begin(input, auth, completedCommandId)
}
/** Resumes only the durable command; callers cannot replace its fields. */
export async function resumeAuthorityIssuance(auth: Session): Promise<AuthorityIssuanceState> {
  const db = await openExisting()
  if (!db) return { state: 'NONE' }
  try {
    const pair = await readPair(db)
    const value = await validated(pair.raw, pair.marker)
    return value ? execute(value, auth) : { state: 'NONE' }
  } finally { db.close() }
}
