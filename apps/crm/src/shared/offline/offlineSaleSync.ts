import { HttpError, requestResponse } from '../api/httpClient'
import { checked, inDatabase, type OfflineSaleRecord, type OfflineSyncRecord, type TerminalSyncOutcome } from './offlineAuthorityLedger'
import { identityRecordKey, identityStoreName, metadataRecordKey, metadataStoreName, syncStoreName } from './offlineRetailDatabase'

type Committed = Extract<OfflineSaleRecord, { state: 'COMMITTED_LOCAL' }>
type ResultKind = OfflineSyncRecord['kind']
type Outcome = { kind: ResultKind; status?: number; message?: string; serverSaleId?: string; conflictIncidentIds?: string[] }
const terminalKinds = new Set<ResultKind>(['ACCEPTED', 'STOCK_CONFLICT', 'HARD_REJECTED'])

function fail(message: string): never { throw new Error(message) }
function evidence(sale: Committed) {
  return { operationId: sale.envelope.offlineOperationId, canonicalPayload: sale.canonicalPayload, payloadHash: sale.payloadHash, signature: sale.signature, publicKey: sale.publicKey }
}
function sameEvidence(sale: Committed, record: OfflineSyncRecord): boolean {
  const expected = evidence(sale)
  return Object.entries(expected).every(([key, value]) => record[key as keyof typeof expected] === value)
}
function nextDelay(attempt: number): number {
  const capped = Math.min(300_000, 5_000 * 2 ** Math.min(attempt - 1, 6))
  return Math.floor(capped * (0.8 + Math.random() * 0.4))
}
function assertAccepted(body: unknown, sale: Committed): string {
  if (!body || typeof body !== 'object') return fail('Offline Sync response is invalid.')
  const result = body as Record<string, unknown>
  const serverSale = result.sale as Record<string, unknown> | undefined
  const envelope = sale.envelope
  if (!serverSale || serverSale.id !== envelope.proposedSaleId || serverSale.location_id !== envelope.locationId || serverSale.status !== 'completed' || serverSale.currency_code !== envelope.currencyCode || serverSale.currency_exponent !== envelope.currencyExponent || serverSale.subtotal_minor !== envelope.subtotalMinor || serverSale.payable_total_minor !== envelope.payableTotalMinor) return fail('Offline Sync accepted Sale differs from local evidence.')
  if (!Array.isArray(result.items) || result.items.length !== envelope.lines.length || !Array.isArray(result.allocations) || result.allocations.length !== 1) return fail('Offline Sync accepted lines or allocations are incomplete.')
  for (const line of envelope.lines) {
    const item = result.items.find((candidate: unknown) => (candidate as Record<string, unknown> | null)?.id === line.id) as Record<string, unknown> | undefined
    if (!item || item.sale_id !== envelope.proposedSaleId || item.product_id !== line.productId || item.quantity !== line.quantity || item.unit_price_minor !== line.unitPriceMinor || item.line_total_minor !== line.quantity * line.unitPriceMinor) return fail('Offline Sync accepted line differs from local evidence.')
  }
  const allocation = result.allocations[0] as Record<string, unknown> | null
  if (!allocation || allocation.id !== envelope.cashAllocation.id || allocation.sale_id !== envelope.proposedSaleId || allocation.method !== 'cash' || allocation.amount_minor !== envelope.payableTotalMinor || allocation.ordinal !== 0) return fail('Offline Sync accepted allocation differs from local evidence.')
  return envelope.proposedSaleId
}
async function reconcileMaterializedConflict(sale: Committed): Promise<Outcome> {
  try {
    const response = await requestResponse(`/api/v1/retail/locations/${encodeURIComponent(sale.envelope.locationId)}/offline-stock-conflicts`)
    const body = await response.json() as { conflicts?: unknown }
    if (!Array.isArray(body?.conflicts)) return { kind: 'REVIEW_HOLD', status: 409, message: 'RETAIL_OFFLINE_REVIEW_REQUIRED' }
    const operationConflicts = body.conflicts.filter(value => value && typeof value === 'object' && (value as Record<string, unknown>).offlineOperationId === sale.envelope.offlineOperationId) as Array<Record<string, unknown>>
    const matched = operationConflicts.filter(item => {
      const line = sale.envelope.lines.find(candidate => candidate.id === item.saleItemId)
      return item.saleId === sale.envelope.proposedSaleId && line?.productId === item.productId
    }) as Array<{ saleItemId: string }>
    if (!matched.length || matched.length !== operationConflicts.length || new Set(matched.map(item => item.saleItemId)).size !== matched.length) return { kind: 'REVIEW_HOLD', status: 409, message: 'RETAIL_OFFLINE_REVIEW_REQUIRED' }
    return { kind: 'STOCK_CONFLICT', status: 409, message: 'VERIFIED_OFFLINE_STOCK_CONFLICT', conflictIncidentIds: matched.map(item => item.saleItemId).sort() }
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return { kind: 'AUTH_HOLD', status: 401, message: error.message }
    if (error instanceof HttpError && error.status === 403) return { kind: 'ACCESS_HOLD', status: 403, message: error.message }
    return { kind: 'RETRY_WAIT', message: error instanceof Error ? error.message : 'Conflict reconciliation is unavailable.' }
  }
}
async function deliver(sale: Committed): Promise<Outcome> {
  const url = `/api/v1/retail/locations/${encodeURIComponent(sale.envelope.locationId)}/offline-sales/sync`
  try {
    const response = await requestResponse(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envelope: sale.envelope, payloadHash: sale.payloadHash, signature: sale.signature }) })
    if (response.status !== 200 && response.status !== 201) return { kind: 'REVIEW_HOLD', status: response.status, message: 'Unexpected Offline Sync success status.' }
    let body: unknown
    try { body = await response.json() } catch { return { kind: 'RETRY_WAIT', status: response.status, message: 'Offline Sync response could not be read.' } }
    try { return { kind: 'ACCEPTED', status: response.status, serverSaleId: assertAccepted(body, sale) } }
    catch (error) { return { kind: 'REVIEW_HOLD', status: response.status, message: error instanceof Error ? error.message : 'Offline Sync response is invalid.' } }
  } catch (error) {
    if (!(error instanceof HttpError)) return { kind: 'RETRY_WAIT', message: error instanceof Error ? error.message : 'Offline Sync network failure.' }
    if (error.status === 401) return { kind: 'AUTH_HOLD', status: error.status, message: error.message }
    if (error.status === 403) return { kind: 'ACCESS_HOLD', status: error.status, message: error.message }
    if (error.status === 409 && error.message === 'VERIFIED_OFFLINE_STOCK_CONFLICT') return { kind: 'STOCK_CONFLICT', status: 409, message: error.message }
    if (error.status === 409 && error.message === 'RETAIL_OFFLINE_REVIEW_REQUIRED') return reconcileMaterializedConflict(sale)
    if (error.status === 409 && error.message === 'IDEMPOTENCY_CONFLICT') return { kind: 'HARD_REJECTED', status: 409, message: error.message }
    if ((error.status === 400 || error.status === 409) && (error.message.startsWith('Retail Offline envelope ') || error.message.startsWith('Retail Offline Envelope '))) return { kind: 'HARD_REJECTED', status: error.status, message: error.message }
    if (error.status === 408 || error.status === 429 || (error.status >= 500 && error.status < 600)) return { kind: 'RETRY_WAIT', status: error.status, message: error.message }
    return { kind: 'REVIEW_HOLD', status: error.status, message: error.message }
  }
}

async function claimNext(excluded: ReadonlySet<string>, resumeAccessHolds: boolean): Promise<{ sale: Committed; attempt: OfflineSyncRecord } | undefined> {
  return inDatabase('readwrite', (state, tx) => {
    if (!state.identity && !state.meta && !state.sales.length && !state.sync.length && !state.authorities.length && !state.permits.length) return undefined
    const meta = checked(state)
    if (!meta) return undefined
    const now = Date.now()
    for (const id of meta.saleOperationIds ?? []) {
      if (excluded.has(id)) continue
      const sale = state.sales.find(item => item.envelope.offlineOperationId === id)
      if (!sale || sale.state !== 'COMMITTED_LOCAL') continue
      const prior = state.sync.find(item => item.operationId === id)
      if (prior && (terminalKinds.has(prior.kind) || prior.kind === 'REVIEW_HOLD' || ((prior.kind === 'AUTH_HOLD' || prior.kind === 'ACCESS_HOLD') && !resumeAccessHolds) || (prior.kind === 'RETRY_WAIT' && prior.nextAttemptAt > now))) continue
      const attemptCount = (prior?.attemptCount ?? 0) + 1
      const attempt: OfflineSyncRecord = { ...evidence(sale), kind: 'RETRY_WAIT', attemptCount, lastAttemptAt: now, nextAttemptAt: now + nextDelay(attemptCount) }
      tx.objectStore(syncStoreName).put(attempt, id)
      return { sale, attempt }
    }
    return undefined
  })
}
async function persistOutcome(sale: Committed, attempt: OfflineSyncRecord, outcome: Outcome): Promise<void> {
  await inDatabase('readwrite', (state, tx) => {
    const meta = checked(state)
    const currentSale = state.sales.find(item => item.envelope.offlineOperationId === attempt.operationId)
    const current = state.sync.find(item => item.operationId === attempt.operationId)
    if (!meta || !currentSale || currentSale.state !== 'COMMITTED_LOCAL' || !sameEvidence(currentSale, attempt) || !sameEvidence(sale, attempt) || !current) return fail('OFFLINE_STATE_LOST')
    if (terminalKinds.has(current.kind)) {
      if (current.kind !== outcome.kind || (outcome.kind === 'ACCEPTED' && current.serverSaleId !== outcome.serverSaleId)) return fail('OFFLINE_SYNC_TERMINAL_CONFLICT')
      return
    }
    if (current.attemptCount !== attempt.attemptCount) return
    const next: OfflineSyncRecord = { ...current, kind: outcome.kind, lastStatus: outcome.status, lastMessage: outcome.message, ...(outcome.serverSaleId ? { serverSaleId: outcome.serverSaleId } : {}), ...(outcome.conflictIncidentIds ? { conflictIncidentIds: outcome.conflictIncidentIds } : {}), ...(terminalKinds.has(outcome.kind) ? { clientObservedAt: new Date().toISOString() } : {}) }
    tx.objectStore(syncStoreName).put(next, attempt.operationId)
    if (terminalKinds.has(outcome.kind)) {
      tx.objectStore(identityStoreName).put({ ...state.identity, offlineSyncEverTerminal: true }, identityRecordKey)
      tx.objectStore(metadataStoreName).put({ ...meta, terminalSyncOutcomes: [...(meta.terminalSyncOutcomes ?? []), { operationId: attempt.operationId, kind: outcome.kind as TerminalSyncOutcome['kind'] }] }, metadataRecordKey)
    }
  })
}

export async function syncPendingOfflineSales(options: { resumeAccessHolds?: boolean } = {}): Promise<{ attempted: number; nextAttemptAt?: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { attempted: 0 }
  const excluded = new Set<string>()
  while (true) {
    const claimed = await claimNext(excluded, options.resumeAccessHolds === true)
    if (!claimed) break
    excluded.add(claimed.attempt.operationId)
    await persistOutcome(claimed.sale, claimed.attempt, await deliver(claimed.sale))
  }
  const nextAttemptAt = await inDatabase('readonly', state => {
    if (!state.identity && !state.meta && !state.sales.length && !state.sync.length && !state.authorities.length && !state.permits.length) return undefined
    checked(state)
    const due = state.sync.filter(item => item.kind === 'RETRY_WAIT').map(item => item.nextAttemptAt)
    return due.length ? Math.min(...due) : undefined
  })
  return { attempted: excluded.size, nextAttemptAt }
}

export async function retryHeldOfflineSale(operationId: string): Promise<void> {
  await inDatabase('readwrite', (state, tx) => {
    checked(state)
    const current = state.sync.find(item => item.operationId === operationId)
    if (!current || current.kind !== 'REVIEW_HOLD') return fail('Offline Sync review hold is unavailable.')
    tx.objectStore(syncStoreName).put({ ...current, kind: 'RETRY_WAIT', nextAttemptAt: 0 }, operationId)
  })
}
