import { equal, rejects, throws } from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  RETAIL_OFFLINE_ENVELOPE_SCHEMA_VERSION,
  RETAIL_OFFLINE_SIGNATURE_ALGORITHM,
  RETAIL_OFFLINE_SIGNATURE_PREFIX,
  canonicalizeRetailOfflineEnvelope,
  type RetailOfflineEnvelope,
} from '@madina/retail'
import { hashRetailOfflineEnvelopeCanonicalPayload, verifyRetailOfflineEnvelope } from './retailOfflineEnvelopeCrypto.js'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailOfflineAuthorityRepository } from './SqliteRetailOfflineAuthorityRepository.js'

const envelope = (overrides: Partial<RetailOfflineEnvelope> = {}): RetailOfflineEnvelope => ({
  schemaVersion: RETAIL_OFFLINE_ENVELOPE_SCHEMA_VERSION,
  offlineOperationId: 'offline-operation-1', authorityId: 'authority-1', authorityVersion: 1,
  permitId: 'permit-1', permitSequence: 0, terminalId: 'terminal-1', terminalKeyVersion: 1,
  userId: 'user-1', locationId: 'location-1', proposedSaleId: 'sale-1',
  lines: [{ id: 'line-2', productId: 'product-2', quantity: 1, unitPriceMinor: 30 }, { id: 'line-1', productId: 'product-1', quantity: 2, unitPriceMinor: 10 }],
  currencyCode: 'USD', currencyExponent: 2,
  cashAllocation: { id: 'payment-1', method: 'cash', amountMinor: 50, ordinal: 0 },
  subtotalMinor: 50, payableTotalMinor: 50, claimedOfflineCompletedAt: '2026-09-20T00:00:00.000Z',
  ...overrides,
})

function signed(value: RetailOfflineEnvelope, pair = generateKeyPairSync('ed25519')) {
  const canonicalPayload = canonicalizeRetailOfflineEnvelope(value)
  return {
    envelope: value,
    payloadHash: createHash('sha256').update(canonicalPayload, 'utf8').digest('hex'),
    signature: `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null, Buffer.from(canonicalPayload), pair.privateKey).toString('base64')}`,
    keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

test('offline envelope canonical bytes and SHA-256 hash are deterministic', () => {
  const first = envelope()
  const reordered = envelope({ lines: [...first.lines].reverse() })
  equal(canonicalizeRetailOfflineEnvelope(first), canonicalizeRetailOfflineEnvelope(reordered))
  equal(hashRetailOfflineEnvelopeCanonicalPayload(canonicalizeRetailOfflineEnvelope(first)), hashRetailOfflineEnvelopeCanonicalPayload(canonicalizeRetailOfflineEnvelope(reordered)))
})

test('real Ed25519 terminal signature verifies only the exact canonical envelope', () => {
  const input = signed(envelope())
  equal(verifyRetailOfflineEnvelope(input).payloadHash, input.payloadHash)
  for (const changed of [
    envelope({ lines: [{ id: 'line-1', productId: 'product-1', quantity: 3, unitPriceMinor: 10 }, { id: 'line-2', productId: 'product-2', quantity: 1, unitPriceMinor: 30 }], subtotalMinor: 60, payableTotalMinor: 60, cashAllocation: { id: 'payment-1', method: 'cash', amountMinor: 60, ordinal: 0 } }),
    envelope({ lines: [{ id: 'line-1', productId: 'product-9', quantity: 2, unitPriceMinor: 10 }, { id: 'line-2', productId: 'product-2', quantity: 1, unitPriceMinor: 30 }] }),
    envelope({ lines: [{ id: 'line-1', productId: 'product-1', quantity: 2, unitPriceMinor: 11 }, { id: 'line-2', productId: 'product-2', quantity: 1, unitPriceMinor: 30 }], subtotalMinor: 52, payableTotalMinor: 52, cashAllocation: { id: 'payment-1', method: 'cash', amountMinor: 52, ordinal: 0 } }),
    envelope({ authorityId: 'authority-2' }), envelope({ permitId: 'permit-2' }), envelope({ locationId: 'location-2' }), envelope({ claimedOfflineCompletedAt: '2026-09-20T00:00:01.000Z' }),
  ]) {
    const canonical = canonicalizeRetailOfflineEnvelope(changed)
    throws(() => verifyRetailOfflineEnvelope({ ...input, envelope: changed, payloadHash: createHash('sha256').update(canonical).digest('hex') }), /verification failed/)
  }
  throws(() => verifyRetailOfflineEnvelope({ ...input, envelope: envelope({ subtotalMinor: 49 }) }), /totals are invalid/)
})

test('offline envelope rejects wrong key, malformed crypto wire values, and hash substitution', () => {
  const input = signed(envelope())
  const other = signed(envelope())
  throws(() => verifyRetailOfflineEnvelope({ ...input, publicKey: other.publicKey }), /verification failed/)
  throws(() => verifyRetailOfflineEnvelope({ ...input, keyAlgorithm: 'ecdsa-p256' }), /unsupported/)
  throws(() => verifyRetailOfflineEnvelope({ ...input, publicKey: 'not-base64!' }), /invalid/)
  throws(() => verifyRetailOfflineEnvelope({ ...input, signature: 'bad' }), /signature is invalid/)
  throws(() => verifyRetailOfflineEnvelope({ ...input, payloadHash: '0'.repeat(64) }), /payload hash is invalid/)
})

test('WebCrypto non-exportable private key interoperates with the Node Ed25519 verifier', async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
  const value = envelope()
  const canonicalPayload = canonicalizeRetailOfflineEnvelope(value)
  const signature = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(canonicalPayload))
  const publicKey = Buffer.from(await globalThis.crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64')
  equal(pair.privateKey.extractable, false)
  equal(verifyRetailOfflineEnvelope({ envelope: value, payloadHash: hashRetailOfflineEnvelopeCanonicalPayload(canonicalPayload), signature: `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${Buffer.from(signature).toString('base64')}`, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey }).payloadHash, hashRetailOfflineEnvelopeCanonicalPayload(canonicalPayload))
})

test('repository verification binds a signature to the enrolled terminal and exact key version', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'retail-offline-crypto-'))
  const file = join(directory, 'x.sqlite')
  initializeDatabase(file)
  const auth = new SqliteAuthRepository(file), access = new SqliteRetailAccessRepository(file), offline = new SqliteRetailOfflineAuthorityRepository(file)
  const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'crypto-binding' }
  try {
    await auth.createUser({ id: 'admin-1', username: 'Admin', normalizedUsername: 'admin', email: 'admin@example.test', role: 'admin', status: 'active', sessionVersion: 1, createdAt: new Date(), updatedAt: new Date() })
    const location = await access.createLocation({ code: 'CRYPTO', name: 'Crypto', type: 'store', status: 'active' }, context)
    const pair = generateKeyPairSync('ed25519')
    const encoded = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const terminal = await offline.enrollTerminal({ locationId: location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: encoded }, context)
    const input = signed(envelope({ terminalId: terminal.id }), pair)
    equal((await offline.verifyEnvelopeSignature(input)).envelope.terminalId, terminal.id)
    await offline.rotateTerminalKey(terminal.id, RETAIL_OFFLINE_SIGNATURE_ALGORITHM, generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), context)
    const wrongVersion = envelope({ terminalId: terminal.id, terminalKeyVersion: 2 })
    await rejects(offline.verifyEnvelopeSignature({ ...input, envelope: wrongVersion, payloadHash: hashRetailOfflineEnvelopeCanonicalPayload(canonicalizeRetailOfflineEnvelope(wrongVersion)) }), /verification failed/)
    const wrongTerminal = envelope({ terminalId: 'other-terminal' })
    await rejects(offline.verifyEnvelopeSignature({ ...input, envelope: wrongTerminal, payloadHash: hashRetailOfflineEnvelopeCanonicalPayload(canonicalizeRetailOfflineEnvelope(wrongTerminal)) }), /not found/)
  } finally { offline.close(); access.close(); auth.close(); rmSync(directory, { recursive: true, force: true }) }
})
