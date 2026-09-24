import { checked, readOfflineStateSnapshot, time, type OfflineSyncRecord } from './offlineAuthorityLedger'
import { authorityStoreName, identityStoreName, metadataStoreName, offlineRetailDatabaseName, permitStoreName, saleStoreName, syncStoreName } from './offlineRetailDatabase'
import { inspectStoredTerminalIdentity } from './terminalIdentity'

export type LocalOperationState = 'PREPARED' | 'WAITING_FIRST_DELIVERY' | OfflineSyncRecord['kind']
export type SafeResultClassification =
  | 'NOT_COMMITTED' | 'NOT_ATTEMPTED' | 'FIRST_ACCEPTANCE' | 'EXACT_REPLAY' | 'VERIFIED_STOCK_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT' | 'ENVELOPE_REJECTED' | 'AUTH_REQUIRED' | 'ACCESS_DENIED'
  | 'REQUEST_TIMEOUT' | 'RATE_LIMITED' | 'SERVER_FAILURE' | 'NO_HTTP_RESULT' | 'SUCCESS_RESPONSE_UNREADABLE'
  | 'REVIEW_REQUIRED' | 'OTHER_RESPONSE'

export type LocalOperation = {
  operationId: string
  proposedSaleId: string
  state: LocalOperationState
  committedAt?: string
  attemptCount: number
  lastAttemptAt?: number
  nextAttemptAt?: number
  lastHttpStatus?: number
  result: SafeResultClassification
  clientObservedAt?: string
}

export type LocalOperationsProjection =
  | { state: 'OFFLINE_STATE_LOST' }
  | { state: 'LEGACY_SCHEMA'; schemaVersion: 3 }
  | {
      state: 'UNINITIALIZED' | 'KEY_GENERATED' | 'ENROLLED'
      terminalId?: string
      locationId?: string
      pendingProvisioning?: 'enrollment' | 'rotation'
      operations: LocalOperation[]
      preparedCount: number
      pendingCount: number
      retryCount: number
      attentionCount: number
      lastLocallyObservedAcceptance?: { operationId: string; clientObservedAt: string }
    }

function classify(record: OfflineSyncRecord): SafeResultClassification {
  switch (record.kind) {
    case 'ACCEPTED': return record.lastStatus === 200 ? 'EXACT_REPLAY' : 'FIRST_ACCEPTANCE'
    case 'STOCK_CONFLICT': return 'VERIFIED_STOCK_CONFLICT'
    case 'HARD_REJECTED': return record.lastMessage === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'ENVELOPE_REJECTED'
    case 'AUTH_HOLD': return 'AUTH_REQUIRED'
    case 'ACCESS_HOLD': return 'ACCESS_DENIED'
    case 'RETRY_WAIT':
      if (record.lastStatus === 408) return 'REQUEST_TIMEOUT'
      if (record.lastStatus === 429) return 'RATE_LIMITED'
      if (record.lastStatus !== undefined && record.lastStatus >= 500 && record.lastStatus < 600) return 'SERVER_FAILURE'
      if (record.lastStatus === undefined) return 'NO_HTTP_RESULT'
      return record.lastStatus === 200 || record.lastStatus === 201 ? 'SUCCESS_RESPONSE_UNREADABLE' : 'OTHER_RESPONSE'
    case 'REVIEW_HOLD': return record.lastMessage === 'RETAIL_OFFLINE_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'OTHER_RESPONSE'
  }
}

/** One open is the observation boundary; an absent database's creation transaction is rolled back. */
function openDiagnosticDatabase(): Promise<{ db: IDBDatabase; changed: () => boolean } | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineRetailDatabaseName)
    let blocked = false
    let absent = false
    request.onupgradeneeded = event => { absent = (event as IDBVersionChangeEvent).oldVersion === 0; request.transaction!.abort() }
    request.onblocked = () => { blocked = true; reject(new Error('Diagnostic database open was blocked.')) }
    request.onerror = () => { if (absent && !blocked) resolve(undefined); else reject(request.error ?? new Error('Diagnostic database open failed.')) }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); reject(new Error('Diagnostic database open was blocked.')); return }
      let changed = false
      db.onversionchange = () => { changed = true; db.close() }
      db.onclose = () => { changed = true }
      resolve({ db, changed: () => changed })
    }
  })
}

/** A local, read-only observation; it is never a statement about another terminal or current server state. */
export async function readLocalOfflineOperations(): Promise<LocalOperationsProjection> {
  try {
    const opened = await openDiagnosticDatabase()
    if (!opened) return { state: 'UNINITIALIZED', operations: [], preparedCount: 0, pendingCount: 0, retryCount: 0, attentionCount: 0 }
    const { db, changed } = opened
    try {
      if (db.version !== 3 && db.version !== 4) throw new Error('Unsupported diagnostic schema.')
      const version = db.version
      const expectedStores = [identityStoreName, authorityStoreName, permitStoreName, metadataStoreName, saleStoreName, ...(version === 4 ? [syncStoreName] : [])]
      if (Array.from(db.objectStoreNames).sort().join('|') !== expectedStores.sort().join('|')) throw new Error('Diagnostic schema is incomplete.')
      const state = await readOfflineStateSnapshot(db, version === 3)
      const inspected = await inspectStoredTerminalIdentity(state.identity)
      const terminal = inspected?.terminal
      const pending = inspected?.pending
      if (changed()) throw new Error('Diagnostic database changed during observation.')
      if (!terminal) {
        if (state.identity || state.meta || state.authorities.length || state.permits.length || state.sales.length || state.saleKeys.length || state.sync.length || state.syncKeys.length) throw new Error('OFFLINE_STATE_LOST')
        return version === 3 ? { state: 'LEGACY_SCHEMA', schemaVersion: 3 } : { state: 'UNINITIALIZED', operations: [], preparedCount: 0, pendingCount: 0, retryCount: 0, attentionCount: 0 }
      }
      if (terminal.state === 'KEY_GENERATED') {
        if (!state.identity || state.identity.publicKey !== terminal.publicKey || state.identity.offlineStateEverInstalled !== undefined || state.identity.offlineSaleEverPrepared !== undefined || state.identity.offlineSyncEverTerminal !== undefined || state.meta || state.authorities.length || state.permits.length || state.sales.length || state.saleKeys.length || state.sync.length || state.syncKeys.length) throw new Error('OFFLINE_STATE_LOST')
        return version === 3 ? { state: 'LEGACY_SCHEMA', schemaVersion: 3 } : { state: 'KEY_GENERATED', ...(pending ? { pendingProvisioning: pending.kind } : {}), operations: [], preparedCount: 0, pendingCount: 0, retryCount: 0, attentionCount: 0 }
      }
      checked(state, terminal)
      if (changed()) throw new Error('Diagnostic database changed during observation.')
      if (version === 3) return { state: 'LEGACY_SCHEMA', schemaVersion: 3 }
      const byOperation = new Map(state.sync.map(record => [record.operationId, record]))
      const operations = state.sales.flatMap<LocalOperation>(sale => {
        if (sale.state === 'PREPARED') return [{ operationId: sale.envelope.offlineOperationId, proposedSaleId: sale.envelope.proposedSaleId, state: 'PREPARED', attemptCount: 0, result: 'NOT_COMMITTED' }]
        time(sale.committedAt)
        const record = byOperation.get(sale.envelope.offlineOperationId)
        return [{
          operationId: sale.envelope.offlineOperationId,
          proposedSaleId: sale.envelope.proposedSaleId,
          state: record?.kind ?? 'WAITING_FIRST_DELIVERY',
          committedAt: sale.committedAt,
          attemptCount: record?.attemptCount ?? 0,
          ...(record && record.attemptCount > 0 ? { lastAttemptAt: record.lastAttemptAt } : {}),
          ...(record?.kind === 'RETRY_WAIT' ? { nextAttemptAt: record.nextAttemptAt } : {}),
          ...(record?.lastStatus !== undefined && Number.isInteger(record.lastStatus) && record.lastStatus >= 100 && record.lastStatus <= 599 ? { lastHttpStatus: record.lastStatus } : {}),
          result: record ? classify(record) : 'NOT_ATTEMPTED',
          ...(record?.clientObservedAt ? { clientObservedAt: record.clientObservedAt } : {}),
        }]
      })
      const accepted = operations.filter(item => item.state === 'ACCEPTED' && item.clientObservedAt)
        .sort((a, b) => Date.parse(b.clientObservedAt!) - Date.parse(a.clientObservedAt!) || a.operationId.localeCompare(b.operationId))[0]
      return {
        state: 'ENROLLED', terminalId: terminal.terminalId, locationId: terminal.locationId,
        ...(pending ? { pendingProvisioning: pending.kind } : {}),
        operations,
        preparedCount: operations.filter(item => item.state === 'PREPARED').length,
        pendingCount: operations.filter(item => ['WAITING_FIRST_DELIVERY', 'RETRY_WAIT', 'AUTH_HOLD', 'ACCESS_HOLD', 'REVIEW_HOLD'].includes(item.state)).length,
        retryCount: operations.filter(item => item.state === 'RETRY_WAIT').length,
        attentionCount: operations.filter(item => ['PREPARED', 'AUTH_HOLD', 'ACCESS_HOLD', 'REVIEW_HOLD', 'STOCK_CONFLICT', 'HARD_REJECTED'].includes(item.state)).length,
        ...(accepted ? { lastLocallyObservedAcceptance: { operationId: accepted.operationId, clientObservedAt: accepted.clientObservedAt! } } : {}),
      }
    } finally { db.close() }
  } catch {
    // Never expose a partial queue from failed key, storage, or terminal-marker validation.
    return { state: 'OFFLINE_STATE_LOST' }
  }
}
