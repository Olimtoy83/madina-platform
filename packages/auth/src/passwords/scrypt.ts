import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import type {
  PasswordCredential,
  PasswordHash,
} from '../types.js'

export const SCRYPT_ALGORITHM = 'scrypt'
export const SCRYPT_VERSION = 1
export const SCRYPT_N = 2 ** 17
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const SCRYPT_KEY_LENGTH = 32
export const SCRYPT_SALT_LENGTH = 16

// Node requires maxmem to exceed 128 * N * r. This is 128 MiB for the
// selected parameters; the additional 32 MiB covers implementation overhead.
export const SCRYPT_MEMORY_COST_BYTES = 128 * SCRYPT_N * SCRYPT_R
export const SCRYPT_MAX_MEMORY_BYTES =
  SCRYPT_MEMORY_COST_BYTES + (32 * 1024 * 1024)

export class PasswordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordValidationError'
  }
}

function validatePassword(password: string): void {
  if (password.length < 12) {
    throw new PasswordValidationError(
      'Password must contain at least 12 characters.',
    )
  }

  if (password.length > 1024) {
    throw new PasswordValidationError(
      'Password must not exceed 1024 characters.',
    )
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: Pick<PasswordHash, 'N' | 'r' | 'p' | 'keyLength'>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      Buffer.from(password, 'utf8'),
      salt,
      parameters.keyLength,
      {
        N: parameters.N,
        r: parameters.r,
        p: parameters.p,
        maxmem: SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }

        resolve(derivedKey)
      },
    )
  })
}

export async function hashPassword(
  password: string,
): Promise<PasswordHash> {
  validatePassword(password)

  const salt = randomBytes(SCRYPT_SALT_LENGTH)
  const parameters = {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keyLength: SCRYPT_KEY_LENGTH,
  }
  const derivedKey = await deriveKey(password, salt, parameters)

  return {
    algorithm: SCRYPT_ALGORITHM,
    version: SCRYPT_VERSION,
    ...parameters,
    salt: salt.toString('base64'),
    hash: derivedKey.toString('base64'),
  }
}

export async function verifyPassword(
  password: string,
  credential: PasswordHash | PasswordCredential,
): Promise<boolean> {
  if (credential.algorithm !== SCRYPT_ALGORITHM) {
    return false
  }

  try {
    const salt = Buffer.from(credential.salt, 'base64')
    const storedHash = Buffer.from(credential.hash, 'base64')

    if (
      salt.length < SCRYPT_SALT_LENGTH ||
      storedHash.length !== credential.keyLength
    ) {
      return false
    }

    const derivedKey = await deriveKey(password, salt, credential)

    return timingSafeEqual(storedHash, derivedKey)
  } catch {
    return false
  }
}

export function needsPasswordRehash(
  credential: PasswordHash | PasswordCredential,
): boolean {
  return credential.algorithm !== SCRYPT_ALGORITHM ||
    credential.version !== SCRYPT_VERSION ||
    credential.N !== SCRYPT_N ||
    credential.r !== SCRYPT_R ||
    credential.p !== SCRYPT_P ||
    credential.keyLength !== SCRYPT_KEY_LENGTH
}
