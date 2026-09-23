import { useRef } from 'react'
import { canonicalizeRetailOfflineEnvelope, hashRetailOfflineEnvelope, validateRetailOfflineEnvelope, verifyRetailOfflineCanonicalPayloadSignature, type RetailOfflineEnvelope } from '@madina/retail'
import { useAuth } from '../../context/useAuth'
import { checked, eligibleForNew, inDatabase, integer, terminalFor, time, validId, type OfflineSaleRecord } from './offlineAuthorityLedger'
import { identityRecordKey, identityStoreName, metadataRecordKey, metadataStoreName, permitStoreName, saleStoreName } from './offlineRetailDatabase'
import { loadTerminalIdentity } from './terminalIdentity'

export type OfflineSaleIntent = { authorityId: string; operationId: string; lines: Array<{ productId: string; quantity: number }> }
export type CommittedOfflineSale = Extract<OfflineSaleRecord, { state: 'COMMITTED_LOCAL' }>
export class OfflineLocalSaleError extends Error {}

function fail(message: string): never { throw new OfflineLocalSaleError(message) }
function normalize(input: OfflineSaleIntent): OfflineSaleRecord['intent'] {
  if (!input || !validId(input.authorityId) || !validId(input.operationId) || !Array.isArray(input.lines) || !input.lines.length) return fail('Offline Sale intent is invalid.')
  const lines = input.lines.map(line => {
    if (!line || !validId(line.productId) || !integer(line.quantity, 1)) return fail('Offline Sale line is invalid.')
    return { productId: line.productId, quantity: line.quantity }
  }).sort((a, b) => a.productId.localeCompare(b.productId))
  if (new Set(lines.map(line => line.productId)).size !== lines.length) return fail('Offline Sale Product is duplicated.')
  return { authorityId: input.authorityId, lines }
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function currentUser(user: () => string | undefined): string {
  const id = user()
  if (!validId(id)) return fail('A proven current AuthSession user is required.')
  return id
}
function preparedEnvelope(input: OfflineSaleIntent, intent: OfflineSaleRecord['intent'], authority: NonNullable<ReturnType<typeof eligibleForNew>>['authority'], permit: NonNullable<ReturnType<typeof eligibleForNew>>['permit'], now: number): RetailOfflineEnvelope {
  let subtotalMinor = 0
  const lines = intent.lines.map(line => {
    const price = authority.snapshot.productPrices.find(p => p.productId === line.productId)?.unitPriceMinor
    if (!integer(price, 1)) return fail('Product has no valid Authority price.')
    const total = line.quantity * price
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(subtotalMinor + total)) return fail('Offline Sale money overflow.')
    subtotalMinor += total
    return { id: crypto.randomUUID(), productId: line.productId, quantity: line.quantity, unitPriceMinor: price }
  })
  return validateRetailOfflineEnvelope({
    schemaVersion: 1, offlineOperationId: input.operationId,
    authorityId: authority.snapshot.authorityId, authorityVersion: authority.snapshot.authorityVersion,
    permitId: permit.permitId, permitSequence: permit.sequence,
    terminalId: authority.snapshot.terminalId, terminalKeyVersion: authority.snapshot.terminalKeyVersion,
    userId: authority.snapshot.userId, locationId: authority.snapshot.locationId,
    proposedSaleId: input.operationId, lines,
    currencyCode: authority.snapshot.currencyCode, currencyExponent: authority.snapshot.currencyExponent,
    cashAllocation: { id: crypto.randomUUID(), method: 'cash', amountMinor: subtotalMinor, ordinal: 0 },
    subtotalMinor, payableTotalMinor: subtotalMinor, claimedOfflineCompletedAt: new Date(now).toISOString(),
  })
}

async function commitForUser(input: OfflineSaleIntent, user: () => string | undefined): Promise<CommittedOfflineSale> {
  const intent = normalize(input)
  const initial = await loadTerminalIdentity()
  if (!initial || initial.state !== 'ENROLLED' || !initial.locationId) return fail('Terminal identity is not usable.')
  const terminal = await terminalFor(initial.locationId, true)
  const committedRetry = await inDatabase('readonly', state => {
    checked(state, terminal)
    const existing = state.sales.find(sale => sale.envelope.offlineOperationId === input.operationId)
    if (!existing) return undefined
    if (!same(existing.intent, intent)) return fail('IDEMPOTENCY_CONFLICT')
    if (existing.envelope.userId !== currentUser(user)) return fail('Authority is not eligible for this user.')
    return existing.state === 'COMMITTED_LOCAL' ? existing : undefined
  })
  if (committedRetry) return committedRetry
  const prepared = await inDatabase('readwrite', (state, tx) => {
    const meta = checked(state, terminal)
    if (!meta) return fail('Authority is not installed.')
    const userId = currentUser(user)
    const existing = state.sales.find(sale => sale.envelope.offlineOperationId === input.operationId)
    if (existing) {
      if (!same(existing.intent, intent)) return fail('IDEMPOTENCY_CONFLICT')
      if (existing.envelope.userId !== userId) return fail('Authority is not eligible for this user.')
      return existing
    }
    const occupied = state.permits.find(permit => permit.operationId === input.operationId)
    if (occupied) return fail(occupied.authorityId === input.authorityId ? 'LEGACY_RESERVED_WITHOUT_PREPARED' : 'Operation is bound to another Authority.')
    const { authority, now, permit } = eligibleForNew(state, meta, terminal, input.authorityId, userId)
    const envelope = preparedEnvelope(input, intent, authority, permit, now)
    const sale: OfflineSaleRecord = { state: 'PREPARED', intent, envelope, publicKey: terminal.publicKey, authoritySnapshot: authority.snapshot }
    tx.objectStore(permitStoreName).put({ ...permit, localState: 'RESERVED', operationId: input.operationId }, [permit.authorityId, permit.sequence])
    tx.objectStore(saleStoreName).put(sale, input.operationId)
    tx.objectStore(identityStoreName).put({ ...state.identity, offlineSaleEverPrepared: true }, identityRecordKey)
    tx.objectStore(metadataStoreName).put({ ...meta, saleOperationIds: [...(meta.saleOperationIds ?? []), input.operationId], lastObservedMs: now }, metadataRecordKey)
    return sale
  })
  if (prepared.state === 'COMMITTED_LOCAL') return prepared

  const signingTerminal = await terminalFor(initial.locationId)
  if (signingTerminal.publicKey !== prepared.publicKey || signingTerminal.terminalId !== prepared.envelope.terminalId || signingTerminal.currentKeyVersion !== prepared.envelope.terminalKeyVersion) return fail('PREPARED signing key is unavailable.')
  if (currentUser(user) !== prepared.envelope.userId) return fail('Authority is not eligible for this user.')
  const envelope = validateRetailOfflineEnvelope(prepared.envelope)
  const canonicalPayload = canonicalizeRetailOfflineEnvelope(envelope)
  const payloadHash = await hashRetailOfflineEnvelope(envelope)
  const signed = await signingTerminal.signOfflineEnvelope(envelope)
  const signature = signed.signature
  if (signed.canonicalPayload !== canonicalPayload || signed.payloadHash !== payloadHash || !await verifyRetailOfflineCanonicalPayloadSignature(prepared.publicKey, canonicalPayload, signature)) return fail('Offline Sale signature evidence is invalid.')

  return inDatabase('readwrite', (state, tx) => {
    const meta = checked(state, signingTerminal)
    if (!meta) return fail('OFFLINE_STATE_LOST')
    const actual = state.sales.find(sale => sale.envelope.offlineOperationId === input.operationId)
    if (!actual || !same(actual.intent, intent)) return fail('OFFLINE_STATE_LOST')
    if (actual.state === 'COMMITTED_LOCAL') {
      if (!same(actual, { ...prepared, state: 'COMMITTED_LOCAL', canonicalPayload: actual.canonicalPayload, payloadHash: actual.payloadHash, signature: actual.signature, committedAt: actual.committedAt })) return fail('OFFLINE_STATE_LOST')
      return actual
    }
    if (!same(actual, prepared)) return fail('PREPARED Sale changed before local commit.')
    if (currentUser(user) !== envelope.userId || state.identity?.pending !== undefined || meta.knownTerminalUnsafe || state.identity?.publicKey !== prepared.publicKey || state.identity.currentKeyVersion !== envelope.terminalKeyVersion) return fail('Terminal or AuthSession changed before local commit.')
    const authority = state.authorities.find(item => item.snapshot.authorityId === envelope.authorityId)
    if (!authority || authority.knownRevoked || !same(authority.snapshot, prepared.authoritySnapshot) || authority.snapshot.userId !== envelope.userId) return fail('Authority changed before local commit.')
    const now = Date.now()
    if (now < meta.lastObservedMs || now < time(authority.snapshot.issuedAt) || now >= time(authority.snapshot.expiresAt)) return fail('Authority local time is not eligible.')
    const permit = state.permits.find(item => item.authorityId === envelope.authorityId && item.permitId === envelope.permitId)
    if (!permit || permit.sequence !== envelope.permitSequence || permit.localState !== 'RESERVED' || permit.operationId !== input.operationId || permit.serverStatus !== 'AVAILABLE') return fail('PREPARED permit changed before local commit.')
    if (canonicalizeRetailOfflineEnvelope(actual.envelope) !== canonicalPayload || signed.canonicalPayload !== canonicalPayload || signed.payloadHash !== payloadHash) return fail('Signed Sale differs from PREPARED Sale.')
    const committed: CommittedOfflineSale = { ...prepared, state: 'COMMITTED_LOCAL', canonicalPayload, payloadHash, signature, committedAt: new Date(now).toISOString() }
    tx.objectStore(saleStoreName).put(committed, input.operationId)
    tx.objectStore(permitStoreName).put({ ...permit, localState: 'CONSUMED_LOCAL', saleId: envelope.proposedSaleId }, [permit.authorityId, permit.sequence])
    tx.objectStore(metadataStoreName).put({ ...meta, lastObservedMs: now }, metadataRecordKey)
    return committed
  })
}

// The caller supplies business intent; the current user comes only from AuthProvider.
export function useCommitOfflineSale() {
  const auth = useAuth()
  const current = useRef(auth)
  current.current = auth
  return (input: OfflineSaleIntent) => commitForUser(input, () => {
    const state = current.current
    return !state.isLoading && !state.error ? state.user?.id : undefined
  })
}
