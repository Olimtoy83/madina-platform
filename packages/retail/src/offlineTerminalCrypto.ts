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

function decodeBase64(value: string, field: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`Retail Offline ${field} is invalid.`)
  let decoded: string
  try { decoded = atob(value) } catch { throw new Error(`Retail Offline ${field} is invalid.`) }
  if (!decoded || btoa(decoded) !== value) throw new Error(`Retail Offline ${field} is invalid.`)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index)
  return bytes
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

export async function verifyRetailOfflineCanonicalPayloadSignature(publicKeyText: string, canonicalPayload: string, signature: string): Promise<boolean> {
  if (typeof canonicalPayload !== 'string' || !canonicalPayload) throw new Error('Retail Offline canonical payload is invalid.')
  if (typeof signature !== 'string' || !signature.startsWith(RETAIL_OFFLINE_SIGNATURE_PREFIX)) throw new Error('Retail Offline Envelope signature is invalid.')
  const signatureBytes = decodeBase64(signature.slice(RETAIL_OFFLINE_SIGNATURE_PREFIX.length), 'Envelope signature')
  if (signatureBytes.length !== 64) throw new Error('Retail Offline Envelope signature is invalid.')
  const publicKeyBytes = decodeBase64(publicKeyText, 'Terminal public key')
  let publicKey: CryptoKey
  try {
    publicKey = await globalThis.crypto.subtle.importKey('spki', publicKeyBytes, { name: 'Ed25519' }, true, ['verify'])
    const exported = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', publicKey))
    if (exported.length !== publicKeyBytes.length || exported.some((byte, index) => byte !== publicKeyBytes[index])) throw new Error()
  } catch { throw new Error('Retail Offline Terminal public key is invalid.') }
  return globalThis.crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signatureBytes, encoder.encode(canonicalPayload))
}

export { RETAIL_OFFLINE_SIGNATURE_ALGORITHM }
