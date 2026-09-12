/**
 * @module api/file
 *
 * High-level API for compressing and decompressing arbitrary binary files.
 *
 * Unlike {@link "./text.js".compress}, this operates on raw bytes end to
 * end — no UTF-8 string round-trip — so non-text files (images, archives,
 * executables, …) restore byte-for-byte.
 *
 * ## Pipeline
 *
 * ```
 *   compressFile:   bytes → tag → Brotli → Base64/Z85
 *   decompressFile: Base64/Z85 → Brotli → tag check → bytes
 * ```
 */

import { compressTaggedPayload, decompressPayload, TAG_FILE } from "../payload/tags.js"
import type { Encoding } from "../types.js"

/**
 * Compress raw file bytes to a pasteable encoded blob.
 *
 * @param data - Raw file content (any bytes).
 * @param encoding - `64` (Base64) or `85` (Z85); default Base64.
 */
export function compressFile(data: Buffer, encoding: Encoding = 64, password?: string): string {
  return compressTaggedPayload(TAG_FILE, data, encoding, password)
}

/**
 * Decompress an encoded file payload back to raw bytes.
 *
 * @throws If the payload is text or a folder archive (wrong tag).
 */
export function decompressFile(
  encoded: string,
  encoding: Encoding = 64,
  password?: string,
): Buffer {
  const raw = decompressPayload(encoded, encoding, password)
  if (raw.tag !== TAG_FILE) {
    throw new Error("This payload is not a compressed file. Use decompress or decompressToPath.")
  }
  return raw.data
}
