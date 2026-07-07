/**
 * @module types
 *
 * Shared type definitions for the text-compress library.
 *
 * Keeping types in a dedicated module avoids circular imports between
 * encoding, compression, and API layers — each domain imports only what
 * it needs from here.
 */

/**
 * Text encoding applied to the Brotli-compressed binary blob.
 *
 * - `64` — standard Base64 (`A-Za-z0-9+/=`). Universally paste-safe.
 * - `85` — Z85 Base85 (ZeroMQ RFC 32). ~8 % smaller; uses punctuation
 *   that is safe in code blocks but not in all chat clients.
 */
export type Encoding = 64 | 85
