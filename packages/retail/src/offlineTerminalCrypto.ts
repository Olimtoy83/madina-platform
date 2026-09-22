import {
  RETAIL_OFFLINE_SIGNATURE_ALGORITHM,
  RETAIL_OFFLINE_SIGNATURE_PREFIX,
  canonicalizeRetailOfflineEnvelope,
  hashRetailOfflineEnvelope,
  type RetailOfflineEnvelope,
} from './offlineEnvelope.js'

const encoder = new TextEncoder()

export interface RetailOfflineSignedEnvelope {
  readonly canonicalPayload: string
  readonly payloadHash: string
  readonly signature: string
}

function base64(bytes: ArrayBuffer): string {
  let value = ''
  for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte)
  return btoa(value)
}

function privateEd25519Key(key: CryptoKey): CryptoKey {
  if (key.type !== 'private' || key.algorithm.name !== 'Ed25519') throw new Error('Retail Offline Terminal private key is invalid.')
  return key
}

export async function exportRetailOfflineTerminalPublicKey(key: CryptoKey): Promise<string> {
  if (key.type !== 'public' || key.algorithm.name !== 'Ed25519') throw new Error('Retail Offline Terminal public key is invalid.')
  return base64(await globalThis.crypto.subtle.exportKey('spki', key))
}

export async function signRetailOfflineCanonicalPayload(privateKey: CryptoKey, canonicalPayload: string): Promise<string> {
  if (typeof canonicalPayload !== 'string' || !canonicalPayload) throw new Error('Retail Offline canonical payload is invalid.')
  return `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${base64(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, privateEd25519Key(privateKey), encoder.encode(canonicalPayload)))}`
}

export async function signRetailOfflineEnvelope(privateKey: CryptoKey, envelope: RetailOfflineEnvelope): Promise<RetailOfflineSignedEnvelope> {
  const canonicalPayload = canonicalizeRetailOfflineEnvelope(envelope)
  return { canonicalPayload, payloadHash: await hashRetailOfflineEnvelope(envelope), signature: await signRetailOfflineCanonicalPayload(privateKey, canonicalPayload) }
}

export { RETAIL_OFFLINE_SIGNATURE_ALGORITHM }
