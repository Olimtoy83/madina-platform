import { equal, throws } from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalizeRetailSaleDraftPayload,
  compareRetailOperationIdentity,
  hashRetailSaleDraftPayload,
  validateRetailOperationIdentity,
  validateRetailSaleDraftPayload,
  type RetailOperationIdentity,
  type RetailSaleDraftPayload,
} from './saleDraft.js'

const draft = (overrides: Partial<RetailSaleDraftPayload> = {}): RetailSaleDraftPayload => ({
  saleId: 'sale-1',
  locationId: 'location-1',
  status: 'draft',
  lines: [{ id: 'line-1', saleId: 'sale-1', productId: 'product-1', quantity: 2 }],
  ...overrides,
})

const identity = async (payload: RetailSaleDraftPayload, overrides: Partial<RetailOperationIdentity> = {}): Promise<RetailOperationIdentity> => ({
  clientOperationId: 'operation-1',
  operationKind: 'retail_sale_draft_create',
  schemaVersion: 1,
  payloadHash: await hashRetailSaleDraftPayload(payload),
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  ...overrides,
})

test('Retail Sale draft accepts draft-only, positive safe-integer lines and an empty collection', () => {
  equal(validateRetailSaleDraftPayload(draft()).lines[0]?.quantity, 2)
  equal(validateRetailSaleDraftPayload(draft({ lines: [] })).lines.length, 0)
})

test('Retail Sale draft rejects invalid status, identifiers, quantities, and duplicate Products', () => {
  throws(() => validateRetailSaleDraftPayload(draft({ status: 'completed' as never })), /status must be draft/)
  throws(() => validateRetailSaleDraftPayload(draft({ saleId: ' ' })), /id is required/)
  throws(() => validateRetailSaleDraftPayload(draft({ locationId: ' ' })), /locationId is required/)
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    throws(() => validateRetailSaleDraftPayload(draft({ lines: [{ id: 'line-1', saleId: 'sale-1', productId: 'product-1', quantity }] })), /positive safe integer/)
  }
  throws(() => validateRetailSaleDraftPayload(draft({ lines: [{ id: 'line-1', saleId: 'sale-1', productId: ' ', quantity: 1 }] })), /productId is required/)
  throws(() => validateRetailSaleDraftPayload(draft({ lines: [
    { id: 'line-1', saleId: 'sale-1', productId: 'product-1', quantity: 1 },
    { id: 'line-2', saleId: 'sale-1', productId: 'product-1', quantity: 2 },
  ] })), /duplicate Product/)
})

test('Retail Sale draft payload hash is canonical and changes for material draft changes', async () => {
  const first = draft()
  const reordered = {
    lines: first.lines,
    status: first.status,
    locationId: first.locationId,
    saleId: first.saleId,
  }
  equal(canonicalizeRetailSaleDraftPayload(first), canonicalizeRetailSaleDraftPayload(reordered))
  equal(await hashRetailSaleDraftPayload(first), await hashRetailSaleDraftPayload(reordered))
  equal(await hashRetailSaleDraftPayload(first) === await hashRetailSaleDraftPayload(draft({ lines: [{ id: 'line-1', saleId: 'sale-1', productId: 'product-1', quantity: 3 }] })), false)
  equal(await hashRetailSaleDraftPayload(first) === await hashRetailSaleDraftPayload(draft({ lines: [{ id: 'line-1', saleId: 'sale-1', productId: 'product-2', quantity: 2 }] })), false)
  equal(await hashRetailSaleDraftPayload(first) === await hashRetailSaleDraftPayload(draft({ locationId: 'location-2' })), false)
})

test('Retail Sale operation identity distinguishes replay-safe and conflicting retries', async () => {
  const prior = await identity(draft())
  equal(compareRetailOperationIdentity(prior, await identity(draft())), 'REPLAY_SAFE')
  equal(compareRetailOperationIdentity(prior, await identity(draft({ locationId: 'location-2' }))), 'IDEMPOTENCY_CONFLICT')
  equal(compareRetailOperationIdentity(prior, await identity(draft(), { clientOperationId: 'operation-2' })), 'DIFFERENT_OPERATION')
  throws(() => validateRetailOperationIdentity({ ...prior, clientOperationId: ' ' }), /clientOperationId is required/)
})
