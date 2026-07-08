/**
 * @module cli/detect
 *
 * Detect whether input is a valid compressed payload for auto-routing.
 */

import { brotliDecompressSync } from "node:zlib"
import { decryptBuffer, isEncrypted } from "../crypto/password.js"
import { decodeBuffer } from "../encoding/index.js"
import { decompressPayload, TAG_FOLDER, TAG_TEXT } from "../payload/tags.js"
import type { Encoding } from "../types.js"

export type DetectResult = "compressed" | "not-compressed" | "password-required"

/** True when an error means the payload is locked, not that it is plain text. */
export function isPasswordRelatedError(err: unknown): boolean {
  const message = (err as Error).message ?? ""
  return message.includes("password-protected") || message === "Invalid password."
}

/**
 * Return whether trimmed encoded text is a valid compressed payload.
 *
 * When `-e` is omitted, both Base64 and Z85 are tried. Encrypted payloads
 * without a password return `password-required` instead of `not-compressed`.
 */
export function detectCompressedPayload(
  encoded: string,
  encoding: Encoding | undefined,
  password?: string,
): DetectResult {
  const trimmed = encoded.trim()
  if (trimmed.length === 0) return "not-compressed"

  const encodings: Encoding[] = encoding ? [encoding] : [64, 85]
  let sawEncryptedWithoutPassword = false

  for (const enc of encodings) {
    let decoded: Buffer
    try {
      decoded = decodeBuffer(trimmed, enc)
    } catch {
      continue
    }

    if (isEncrypted(decoded)) {
      if (!password) {
        sawEncryptedWithoutPassword = true
        continue
      }
      decoded = decryptBuffer(decoded, password)
    }

    try {
      const raw = brotliDecompressSync(decoded)
      const tag = raw[0]
      if (tag === TAG_TEXT || tag === TAG_FOLDER) {
        return "compressed"
      }
    } catch {}
  }

  if (sawEncryptedWithoutPassword) return "password-required"
  return "not-compressed"
}

/**
 * Resolve the best encoding for decompress after auto-detection.
 *
 * When `-e` is set, use it. Otherwise return the encoding that validates.
 */
export function resolveDetectedEncoding(
  encoded: string,
  encoding: Encoding | undefined,
  password?: string,
): Encoding {
  if (encoding) return encoding

  const trimmed = encoded.trim()
  for (const enc of [64, 85] as const) {
    if (detectCompressedPayload(trimmed, enc, password) === "compressed") {
      return enc
    }
  }
  return 64
}

/** Validate using the full decompress path (used when forcing decompress). */
export function assertDecompressible(encoded: string, encoding: Encoding, password?: string): void {
  const { tag } = decompressPayload(encoded.trim(), encoding, password)
  if (tag !== TAG_TEXT && tag !== TAG_FOLDER) {
    throw new Error(`Corrupt or unrecognized payload (tag 0x${tag.toString(16)}).`)
  }
}
