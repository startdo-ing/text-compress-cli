/**
 * @module encoding
 *
 * Facade that selects Base64 or Z85 encoding based on the {@link Encoding}
 * discriminator. Higher layers (compression API, streaming pipeline) call
 * only `encodeBuffer` / `decodeBuffer` — they never import z85 or base64
 * directly.
 *
 * ## Strategy pattern
 *
 * This is a simple strategy pattern: the `encoding` parameter picks the
 * algorithm at runtime without branching scattered across the codebase.
 */

import type { Encoding } from "../types.js";
import { decodeBase64, encodeBase64 } from "./base64.js";
import { decodeBase85, encodeBase85 } from "./z85.js";

/** Encode a binary buffer to a pasteable text string. */
export function encodeBuffer(buffer: Buffer, encoding: Encoding): string {
	if (encoding === 64) return encodeBase64(buffer);
	if (encoding === 85) return encodeBase85(buffer);
	throw new Error(`Unsupported encoding: ${encoding}`);
}

/** Decode a pasteable text string back to a binary buffer. */
export function decodeBuffer(str: string, encoding: Encoding): Buffer {
	if (encoding === 64) return decodeBase64(str);
	if (encoding === 85) return decodeBase85(str);
	throw new Error(`Unsupported encoding: ${encoding}`);
}

/**
 * Estimate the character length of an encoded string without encoding.
 *
 * Used by the streaming pipeline to pre-calculate split part counts
 * before writing files to disk.
 *
 * - Base64: `ceil(bytes / 3) × 4`
 * - Z85: accounts for the 1-byte pad prefix and block padding
 */
export function estimatedEncodedLength(
	binaryBytes: number,
	encoding: Encoding,
): number {
	if (encoding === 64) return Math.ceil(binaryBytes / 3) * 4;
	const padded = 1 + binaryBytes + ((4 - ((binaryBytes + 1) % 4)) % 4);
	return (padded / 4) * 5;
}
