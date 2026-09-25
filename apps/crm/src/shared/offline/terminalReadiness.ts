import { HttpError } from '../api/httpClient'
import { getRetailLocation, getRetailOfflineAuthorityDetail, getRetailOfflineAuthorityPermits, getRetailOfflineTerminalDetail } from '../api/retailApi'
import type { RetailLocation } from '@madina/retail'
import type { AuthContextValue } from '../../context/AuthContext'
import { canRetail } from '../auth/retailPermissions'
import { checked, eligibleForNew, inspectServerOfflineAuthority, readOfflineStateSnapshot, time, type State } from './offlineAuthorityLedger'
import { authorityStoreName, identityStoreName, metadataStoreName, offlineRetailDatabaseName, permitStoreName, saleStoreName, syncStoreName } from './offlineRetailDatabase'
import { inspectStoredTerminalIdentity, type TerminalIdentity } from './terminalIdentity'

export type TerminalReadinessReason =
  | 'READY' | 'UNAUTHENTICATED' | 'CAPABILITY_DENIED' | 'LOCATION_ACCESS_DENIED' | 'SERVER_UNAVAILABLE'
  | 'IDENTITY_MISSING' | 'PROVISIONING_PENDING' | 'TERMINAL_NOT_ENROLLED' | 'TERMINAL_MISSING'
  | 'TERMINAL_REVOKED' | 'TERMINAL_MISMATCH' | 'KEY_VERSION_MISMATCH'
  | 'AUTHORITY_MISSING' | 'AUTHORITY_EXPIRED' | 'AUTHORITY_REVOKED' | 'AUTHORITY_MISMATCH'
  | 'PERMIT_UNAVAILABLE' | 'INTEGRITY_ERROR'
export type TerminalReadinessAction = 'AUTHENTICATE' | 'REQUEST_ACCESS' | 'REGISTER_BROWSER' | 'RESUME_ENROLLMENT'
  | 'INSTALL_AUTHORITY' | 'RENEW_AUTHORITY' | 'CONTACT_ADMIN' | 'RETRY_SERVER_CHECK' | 'NONE_READY'
export type TerminalReadiness = {
  status: 'READY' | 'NOT_READY'
  reason: TerminalReadinessReason
  nextAction: TerminalReadinessAction
  requestedLocationId: string
  currentLocationId?: string
  terminalId?: string
  terminalKeyVersion?: number
  terminalRevoked?: boolean
  terminalMismatch?: boolean
  authorityId?: string
  authorityExpiresAt?: string
  availablePermitCount: number
  serverVerified: boolean
}

const actions: Record<TerminalReadinessReason, TerminalReadinessAction> = {
  READY: 'NONE_READY', UNAUTHENTICATED: 'AUTHENTICATE', CAPABILITY_DENIED: 'REQUEST_ACCESS',
  LOCATION_ACCESS_DENIED: 'REQUEST_ACCESS', SERVER_UNAVAILABLE: 'RETRY_SERVER_CHECK',
  IDENTITY_MISSING: 'REGISTER_BROWSER', PROVISIONING_PENDING: 'RESUME_ENROLLMENT',
  TERMINAL_NOT_ENROLLED: 'RESUME_ENROLLMENT', TERMINAL_MISSING: 'CONTACT_ADMIN',
  TERMINAL_REVOKED: 'CONTACT_ADMIN', TERMINAL_MISMATCH: 'CONTACT_ADMIN', KEY_VERSION_MISMATCH: 'CONTACT_ADMIN',
  AUTHORITY_MISSING: 'INSTALL_AUTHORITY', AUTHORITY_EXPIRED: 'RENEW_AUTHORITY',
  AUTHORITY_REVOKED: 'RENEW_AUTHORITY', AUTHORITY_MISMATCH: 'CONTACT_ADMIN',
  PERMIT_UNAVAILABLE: 'RENEW_AUTHORITY', INTEGRITY_ERROR: 'CONTACT_ADMIN',
}

function result(reason: TerminalReadinessReason, requestedLocationId: string, details: Partial<Omit<TerminalReadiness, 'status' | 'reason' | 'nextAction' | 'requestedLocationId'>> = {}): TerminalReadiness {
  return { status: reason === 'READY' ? 'READY' : 'NOT_READY', reason, nextAction: actions[reason], requestedLocationId, availablePermitCount: 0, serverVerified: false, ...details }
}

function serverFailure(error: unknown, locationId: string, details: Partial<TerminalReadiness> = {}): TerminalReadiness {
  if (error instanceof HttpError && error.status === 401) return result('UNAUTHENTICATED', locationId, details)
  if (error instanceof HttpError && error.status === 403) return result('LOCATION_ACCESS_DENIED', locationId, details)
  return result('SERVER_UNAVAILABLE', locationId, details)
}

/** Open an existing v4 database without creating or upgrading an absent/older one. */
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

type LocalRead = { state: State; terminal?: TerminalIdentity; pending?: 'enrollment' | 'rotation' }
async function readLocal(): Promise<LocalRead | undefined> {
  const db = await openExisting()
  if (!db) return undefined
  try {
    const stores = [authorityStoreName, identityStoreName, metadataStoreName, permitStoreName, saleStoreName, syncStoreName]
    if (db.version !== 4 || Array.from(db.objectStoreNames).sort().join('|') !== stores.sort().join('|')) throw new Error('Offline schema mismatch.')
    let changed = false
    db.onversionchange = () => { changed = true; db.close() }
    const state = await readOfflineStateSnapshot(db)
    const inspected = await inspectStoredTerminalIdentity(state.identity)
    if (changed) throw new Error('Offline database changed.')
    if (!inspected) {
      if (state.meta || state.authorities.length || state.permits.length || state.sales.length || state.saleKeys.length || state.sync.length || state.syncKeys.length) throw new Error('OFFLINE_STATE_LOST')
      return { state }
    }
    if (inspected.terminal.state === 'ENROLLED') checked(state, inspected.terminal)
    else if (state.identity?.offlineStateEverInstalled !== undefined || state.identity?.offlineSaleEverPrepared !== undefined || state.identity?.offlineSyncEverTerminal !== undefined || state.meta || state.authorities.length || state.permits.length || state.sales.length || state.saleKeys.length || state.sync.length || state.syncKeys.length) throw new Error('OFFLINE_STATE_LOST')
    if (changed) throw new Error('Offline database changed.')
    return { state, terminal: inspected.terminal, pending: inspected.pending?.kind }
  } finally { db.close() }
}

/** Online, observational setup check. It never provisions, installs, or reserves anything. */
export async function checkTerminalReadiness(locationId: string, auth: Pick<AuthContextValue, 'user' | 'isLoading' | 'error'>): Promise<TerminalReadiness> {
  if (auth.isLoading || auth.error || !auth.user) return result('UNAUTHENTICATED', locationId)
  if (!canRetail(auth.user, 'retail:offline-terminals:manage')) return result('CAPABILITY_DENIED', locationId)
  if (!locationId || locationId.trim() !== locationId) return result('LOCATION_ACCESS_DENIED', locationId)
  let location: RetailLocation
  try {
    location = await getRetailLocation(locationId)
    if (!location || location.id !== locationId || location.status !== 'active' || location.type !== 'store' || !location.currencyCode || !Number.isSafeInteger(location.currencyExponent)) return result('LOCATION_ACCESS_DENIED', locationId)
  } catch (error) { return serverFailure(error, locationId) }

  let local: LocalRead | undefined
  try { local = await readLocal() } catch { return result('INTEGRITY_ERROR', locationId) }
  if (!local?.terminal) return result('IDENTITY_MISSING', locationId)
  const terminal = local.terminal
  const identity = { currentLocationId: terminal.locationId, terminalId: terminal.terminalId, terminalKeyVersion: terminal.currentKeyVersion }
  if (local.pending) return result('PROVISIONING_PENDING', locationId, identity)
  if (terminal.state !== 'ENROLLED') return result('TERMINAL_NOT_ENROLLED', locationId, identity)
  if (terminal.locationId !== locationId) return result('TERMINAL_MISMATCH', locationId, { ...identity, terminalMismatch: true })

  let detail: Awaited<ReturnType<typeof getRetailOfflineTerminalDetail>>
  try { detail = await getRetailOfflineTerminalDetail(locationId, terminal.terminalId!) }
  catch (error) {
    if (error instanceof HttpError && error.status === 404) return result('TERMINAL_MISSING', locationId, identity)
    return serverFailure(error, locationId, identity)
  }
  if (!detail || detail.terminalId !== terminal.terminalId || detail.locationId !== locationId || !Number.isSafeInteger(detail.currentKeyVersion) || typeof detail.revoked !== 'boolean') return result('TERMINAL_MISMATCH', locationId, { ...identity, terminalMismatch: true })
  if (detail.revoked) return result('TERMINAL_REVOKED', locationId, { ...identity, terminalRevoked: true })
  if (detail.currentKeyVersion !== terminal.currentKeyVersion) return result('KEY_VERSION_MISMATCH', locationId, { ...identity, terminalMismatch: true })

  const meta = local.state.meta
  if (!meta) return result('AUTHORITY_MISSING', locationId, identity)
  if (meta.knownTerminalUnsafe) return result('INTEGRITY_ERROR', locationId, identity)
  const own = local.state.authorities.filter(item => item.snapshot.userId === auth.user!.id && item.snapshot.locationId === locationId && item.snapshot.terminalId === terminal.terminalId)
    .sort((a, b) => b.snapshot.expiresAt.localeCompare(a.snapshot.expiresAt))
  if (!own.length) return result(local.state.authorities.length ? 'AUTHORITY_MISMATCH' : 'AUTHORITY_MISSING', locationId, identity)
  let fallback: TerminalReadiness | undefined
  for (const record of own) {
    const authority = { ...identity, authorityId: record.snapshot.authorityId, authorityExpiresAt: record.snapshot.expiresAt }
    if (record.knownRevoked) { fallback ??= result('AUTHORITY_REVOKED', locationId, authority); continue }
    if (record.snapshot.terminalKeyVersion !== terminal.currentKeyVersion) { fallback ??= result('AUTHORITY_MISMATCH', locationId, authority); continue }
    const now = Date.now()
    if (now < time(record.snapshot.issuedAt) || now >= time(record.snapshot.expiresAt) || now < meta.lastObservedMs) { fallback ??= result('AUTHORITY_EXPIRED', locationId, authority); continue }
    let server: ReturnType<typeof inspectServerOfflineAuthority>
    try {
      server = inspectServerOfflineAuthority(
        await getRetailOfflineAuthorityDetail(locationId, record.snapshot.authorityId),
        await getRetailOfflineAuthorityPermits(locationId, record.snapshot.authorityId),
      )
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) { fallback ??= result('AUTHORITY_MISMATCH', locationId, authority); continue }
      if (error instanceof HttpError || error instanceof TypeError) return serverFailure(error, locationId, authority)
      return result('AUTHORITY_MISMATCH', locationId, authority)
    }
    if (server.revoked) { fallback ??= result('AUTHORITY_REVOKED', locationId, authority); continue }
    if (JSON.stringify(server.snapshot) !== JSON.stringify(record.snapshot) || server.snapshot.currencyCode !== location.currencyCode || server.snapshot.currencyExponent !== location.currencyExponent) { fallback ??= result('AUTHORITY_MISMATCH', locationId, authority); continue }
    const localPermits = local.state.permits.filter(item => item.authorityId === record.snapshot.authorityId).sort((a, b) => a.sequence - b.sequence)
    if (localPermits.length !== server.permits.length || localPermits.some((item, i) => item.permitId !== server.permits[i]?.permitId || item.sequence !== server.permits[i]?.sequence || (item.serverStatus !== 'AVAILABLE' && server.permits[i]?.status === 'AVAILABLE'))) {
      fallback ??= result('AUTHORITY_MISMATCH', locationId, authority); continue
    }
    const availablePermitCount = localPermits.filter((item, i) => item.localState === 'AVAILABLE' && item.serverStatus === 'AVAILABLE' && server.permits[i]?.status === 'AVAILABLE').length
    if (!availablePermitCount) { fallback ??= result('PERMIT_UNAVAILABLE', locationId, { ...authority, serverVerified: true }); continue }
    try { eligibleForNew(local.state, meta, terminal, record.snapshot.authorityId, auth.user.id) }
    catch { fallback ??= result('PERMIT_UNAVAILABLE', locationId, { ...authority, serverVerified: true }); continue }
    // Recheck after network reads so a concurrent local reservation cannot leave a stale READY projection.
    let latest: LocalRead | undefined
    try { latest = await readLocal() } catch { return result('INTEGRITY_ERROR', locationId, authority) }
    if (!latest?.terminal || latest.pending || latest.terminal.terminalId !== terminal.terminalId || latest.terminal.locationId !== locationId || latest.terminal.currentKeyVersion !== terminal.currentKeyVersion || !latest.state.meta || latest.state.meta.knownTerminalUnsafe) return result('INTEGRITY_ERROR', locationId, authority)
    const latestAuthority = latest.state.authorities.find(item => item.snapshot.authorityId === record.snapshot.authorityId)
    if (!latestAuthority || latestAuthority.knownRevoked || JSON.stringify(latestAuthority.snapshot) !== JSON.stringify(record.snapshot)) return result('AUTHORITY_MISMATCH', locationId, authority)
    const freshLocal = latest.state.permits.filter(item => item.authorityId === record.snapshot.authorityId && item.localState === 'AVAILABLE' && item.serverStatus === 'AVAILABLE' && server.permits.some(permit => permit.permitId === item.permitId && permit.sequence === item.sequence && permit.status === 'AVAILABLE'))
    if (!freshLocal.length) return result('PERMIT_UNAVAILABLE', locationId, { ...authority, serverVerified: true })
    try { eligibleForNew(latest.state, latest.state.meta, latest.terminal, record.snapshot.authorityId, auth.user.id) }
    catch { return result('PERMIT_UNAVAILABLE', locationId, { ...authority, serverVerified: true }) }
    return result('READY', locationId, { ...authority, availablePermitCount: Math.min(availablePermitCount, freshLocal.length), serverVerified: true, terminalRevoked: false, terminalMismatch: false })
  }
  return fallback ?? result('AUTHORITY_MISSING', locationId, identity)
}
