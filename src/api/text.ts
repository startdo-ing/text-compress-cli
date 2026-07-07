/**
 * @module api/text
 *
 * High-level API for compressing and decompressing UTF-8 text strings.
 *
 * ## Pipeline
 *
 * ```
 *   compress:   text → UTF-8 bytes → tag → Brotli → Base64/Z85
 *   decompress: Base64/Z85 → Brotli → tag check → UTF-8 string
 * ```
 *
 * Text and folder payloads share the same outer encoding but are
 * distinguished by the leading tag byte after decompression.
 */

import { compressTaggedPayload, decompressPayload, TAG_TEXT } from "../payload/tags.js"
import type { Encoding } from "../types.js"

/**
 * Compress a UTF-8 string to a pasteable encoded blob.
 *
 * @param text - Input string (any Unicode code points).
 * @param encoding - `64` (Base64) or `85` (Z85); default Base64.
 */
export function compress(text: string, encoding: Encoding = 64): string {
  return compressTaggedPayload(TAG_TEXT, Buffer.from(text, "utf-8"), encoding)
}

/**
 * Decompress an encoded text payload back to a UTF-8 string.
 *
 * @throws If the payload is a folder archive (wrong tag).
 */
export function decompress(encoded: string, encoding: Encoding = 64): string {
  const raw = decompressPayload(encoded, encoding)
  if (raw.tag !== TAG_TEXT) {
    throw new Error("This payload is a compressed folder, not text. Use decompressToPath.")
  }
  return raw.data.toString("utf-8")
}
