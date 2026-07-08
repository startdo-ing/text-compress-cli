/**
 * @module crypto/password
 *
 * Optional password protection for compressed payloads.
 *
 * When a password is set at compress time, the Brotli-compressed bytes are
 * encrypted with AES-256-GCM before Base64/Z85 encoding. The wire format is:
 *
 * ```
 *   [MAGIC: 4][salt: 16][iv: 12][authTag: 16][ciphertext…]
 * ```
 *
 * Unencrypted payloads omit the magic prefix and remain compatible with
 * earlier versions of the tool.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"

const MAGIC = Buffer.from("TCP\x01")
const SALT_LENGTH = 16
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

/** True when decoded binary data starts with the password-protection magic. */
export function isEncrypted(data: Buffer): boolean {
  return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC)
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
}

/** Encrypt Brotli-compressed bytes with a user password. */
export function encryptBuffer(plaintext: Buffer, password: string): Buffer {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(password, salt)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, authTag, encrypted])
}

/** Decrypt password-protected bytes back to the original Brotli blob. */
export function decryptBuffer(data: Buffer, password: string): Buffer {
  if (!isEncrypted(data)) {
    throw new Error("This payload is not password-protected.")
  }
  const offset = MAGIC.length
  const salt = data.subarray(offset, offset + SALT_LENGTH)
  const iv = data.subarray(offset + SALT_LENGTH, offset + SALT_LENGTH + IV_LENGTH)
  const authTag = data.subarray(
    offset + SALT_LENGTH + IV_LENGTH,
    offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  )
  const ciphertext = data.subarray(offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const key = deriveKey(password, salt)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error("Invalid password.")
  }
}
