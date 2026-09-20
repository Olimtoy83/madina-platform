import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import {
  RETAIL_OFFLINE_SIGNATURE_ALGORITHM,
  RETAIL_OFFLINE_SIGNATURE_PREFIX,
  canonicalizeRetailOfflineEnvelope,
  type RetailOfflineEnvelope,
  validateRetailOfflineEnvelope,
} from '@madina/retail'

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const hash = /^[a-f0-9]{64}$/

export interface VerifiedRetailOfflineEnvelope {
  readonly envelope: RetailOfflineEnvelope
  readonly canonicalPayload: string
  readonly payloadHash: string
}

function decodeBase64(value: string, field: string): Buffer {
  if (typeof value !== 'string' || !value || !base64.test(value)) throw new Error(`Retail Offline ${field} is invalid.`)
  const decoded = Buffer.from(value, 'base64')
  if (!decoded.length || decoded.toString('base64') !== value) throw new Error(`Retail Offline ${field} is invalid.`)
  return decoded
}

export function parseRetailOfflineTerminalPublicKey(keyAlgorithm: string, publicKey: string): KeyObject {
  if (keyAlgorithm !== RETAIL_OFFLINE_SIGNATURE_ALGORITHM) throw new Error('Retail Offline Terminal key algorithm is unsupported.')
  const encoded = decodeBase64(publicKey, 'Terminal public key')
  let key: KeyObject
  try { key = createPublicKey({ key: encoded, format: 'der', type: 'spki' }) } catch { throw new Error('Retail Offline Terminal public key is invalid.') }
  if (key.asymmetricKeyType !== 'ed25519' || !Buffer.from(key.export({ format: 'der', type: 'spki' })).equals(encoded)) throw new Error('Retail Offline Terminal public key is invalid.')
  return key
}

export function validateRetailOfflineTerminalPublicKey(keyAlgorithm: string, publicKey: string): void {
  parseRetailOfflineTerminalPublicKey(keyAlgorithm, publicKey)
}

export function parseRetailOfflineEnvelopeSignature(signature: string): Buffer {
  if (typeof signature !== 'string' || !signature.startsWith(RETAIL_OFFLINE_SIGNATURE_PREFIX)) throw new Error('Retail Offline Envelope signature is invalid.')
  const bytes = decodeBase64(signature.slice(RETAIL_OFFLINE_SIGNATURE_PREFIX.length), 'Envelope signature')
  if (bytes.length !== 64) throw new Error('Retail Offline Envelope signature is invalid.')
  return bytes
}

export function hashRetailOfflineEnvelopeCanonicalPayload(canonicalPayload: string): string {
  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex')
}

export function verifyRetailOfflineEnvelope(input: { envelope: unknown; payloadHash: string; signature: string; keyAlgorithm: string; publicKey: string }): VerifiedRetailOfflineEnvelope {
  const envelope = validateRetailOfflineEnvelope(input.envelope)
  const canonicalPayload = canonicalizeRetailOfflineEnvelope(envelope)
  const payloadHash = hashRetailOfflineEnvelopeCanonicalPayload(canonicalPayload)
  if (typeof input.payloadHash !== 'string' || !hash.test(input.payloadHash) || !timingSafeEqual(Buffer.from(input.payloadHash), Buffer.from(payloadHash))) throw new Error('Retail Offline Envelope payload hash is invalid.')
  const key = parseRetailOfflineTerminalPublicKey(input.keyAlgorithm, input.publicKey)
  if (!verify(null, Buffer.from(canonicalPayload, 'utf8'), key, parseRetailOfflineEnvelopeSignature(input.signature))) throw new Error('Retail Offline Envelope signature verification failed.')
  return { envelope, canonicalPayload, payloadHash }
}
