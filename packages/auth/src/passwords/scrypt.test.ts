import {
  equal,
  rejects,
} from 'node:assert/strict'
import test from 'node:test'
import {
  SCRYPT_KEY_LENGTH,
  SCRYPT_MAX_MEMORY_BYTES,
  SCRYPT_MEMORY_COST_BYTES,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_SALT_LENGTH,
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
} from './scrypt.js'

const password = 'correct horse battery staple'

test('scrypt hashes and verifies a password with the configured parameters', async () => {
  const credential = await hashPassword(password)

  equal(credential.algorithm, 'scrypt')
  equal(credential.N, SCRYPT_N)
  equal(credential.r, SCRYPT_R)
  equal(credential.p, SCRYPT_P)
  equal(credential.keyLength, SCRYPT_KEY_LENGTH)
  equal(Buffer.from(credential.salt, 'base64').length, SCRYPT_SALT_LENGTH)
  equal(Buffer.from(credential.hash, 'base64').length, SCRYPT_KEY_LENGTH)
  equal(await verifyPassword(password, credential), true)
  equal(needsPasswordRehash(credential), false)
})

test('scrypt rejects an invalid password without exposing plaintext', async () => {
  const credential = await hashPassword(password)

  equal(await verifyPassword('incorrect password', credential), false)
  equal(JSON.stringify(credential).includes(password), false)
  await rejects(hashPassword('short'), /at least 12 characters/)
})

test('scrypt uses distinct salts and reserves explicit safe memory', async () => {
  const first = await hashPassword(password)
  const second = await hashPassword(password)

  equal(first.salt === second.salt, false)
  equal(first.hash === second.hash, false)
  equal(SCRYPT_MEMORY_COST_BYTES, 128 * SCRYPT_N * SCRYPT_R)
  equal(SCRYPT_MAX_MEMORY_BYTES, 160 * 1024 * 1024)
  equal(SCRYPT_MAX_MEMORY_BYTES > SCRYPT_MEMORY_COST_BYTES, true)
})
