/**
 * @module encoding/base64
 *
 * Thin wrapper around Node.js built-in Base64 encoding.
 *
 * Base64 maps every 3 bytes → 4 ASCII characters using a 64-character
 * alphabet (`A–Z a–z 0–9 + /`) plus `=` padding. It expands data by
 * ~33 % but is universally supported and paste-safe.
 *
 * We delegate to `Buffer.toString("base64")` rather than reimplementing
 * the algorithm — Node's implementation is well-tested and SIMD-optimised.
 */

/** Encode raw bytes to a standard Base64 string. */
export function encodeBase64(buffer: Buffer): string {
	return buffer.toString("base64");
}

/** Decode a Base64 string back to raw bytes. */
export function decodeBase64(str: string): Buffer {
	return Buffer.from(str, "base64");
}
