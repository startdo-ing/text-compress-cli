/**
 * @module payload/tags
 *
 * Payload tagging — discriminated union over compressed blobs.
 *
 * After Brotli decompression the first byte tells the consumer what kind
 * of payload follows. This is a lightweight **type tag** pattern (similar
 * to MIME types or protobuf field numbers) that lets a single encoded
 * string represent either UTF-8 text or a folder archive without external
 * metadata.
 *
 * ## On-the-wire layout
 *
 * ```
 *   [tag: u8][payload bytes…]
 *        │         │
 *        │         └── Brotli-compressed body (text UTF-8 or archive binary)
 *        └── TAG_TEXT (0x01) or TAG_FOLDER (0x02)
 * ```
 *
 * ## Full pipeline (compress)
 *
 * ```
 *   raw data → wrapPayload(tag, data) → brotliCompress → encodeBuffer
 * ```
 *
 * ## Full pipeline (decompress)
 *
 * ```
 *   encoded string → decodeBuffer → brotliDecompress → read tag byte → route
 * ```
 */

import { brotliDecompressSync } from "node:zlib";
import { brotliCompress } from "../compression/brotli.js";
import { decodeBuffer, encodeBuffer } from "../encoding/index.js";
import type { Encoding } from "../types.js";

/** Tag byte for UTF-8 text payloads. */
export const TAG_TEXT = 0x01;

/** Tag byte for folder archive payloads. */
export const TAG_FOLDER = 0x02;

/**
 * Prepend a 1-byte type tag to raw payload bytes.
 *
 * @param tag - {@link TAG_TEXT} or {@link TAG_FOLDER}.
 * @param data - Uncompressed payload body.
 */
export function wrapPayload(tag: number, data: Buffer): Buffer {
	return Buffer.concat([Buffer.from([tag]), data]);
}

/**
 * Decode and decompress an encoded string, returning the tag and body.
 *
 * Low-level entry point used by both `decompress()` and `decompressToPath()`.
 */
export function decompressPayload(
	encoded: string,
	encoding: Encoding,
): { tag: number; data: Buffer } {
	const raw = brotliDecompressSync(decodeBuffer(encoded, encoding));
	return { tag: raw[0], data: raw.subarray(1) };
}

/**
 * Compress, tag, and encode a raw buffer in one step.
 *
 * Shared helper for text and folder compression paths.
 */
export function compressTaggedPayload(
	tag: number,
	data: Buffer,
	encoding: Encoding,
): string {
	return encodeBuffer(brotliCompress(wrapPayload(tag, data)), encoding);
}
