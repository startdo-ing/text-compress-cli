/**
 * @module encoding/z85
 *
 * Z85 (ZeroMQ RFC 32) Base85 encoder and decoder.
 *
 * ## Why Z85 instead of Ascii85?
 *
 * Standard Ascii85 uses `"` and `\` — characters that break when pasted
 * into chat or JSON strings. Z85 picks an alphabet of 85 printable ASCII
 * characters that avoid quotes, backslashes, and backticks, making the
 * output safe to paste verbatim into most code contexts.
 *
 * ## Algorithm (base-85 positional encoding)
 *
 * Z85 groups input into 4-byte blocks and maps each block to 5 printable
 * characters:
 *
 * ```
 *   value = b0·256³ + b1·256² + b2·256 + b3     (0 ≤ value < 256⁴)
 *   char[j] = alphabet[value mod 85]             (j = 4 … 0)
 *   value   = floor(value / 85)
 * ```
 *
 * Decoding reverses the process: 5 characters → one 32-bit value → 4 bytes.
 *
 * ## Padding scheme
 *
 * Z85 requires input length to be a multiple of 4 bytes. We prefix a
 * 1-byte pad count (`0–3`) so arbitrary-length payloads round-trip exactly:
 *
 * ```
 *   [padCount: u8][payload bytes…][zero padding to multiple of 4]
 * ```
 *
 * @see https://rfc.zeromq.org/spec/32/ — Z85 specification
 */

/** 85-character alphabet defined by the Z85 specification. */
export const Z85_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#"

/**
 * Encode a buffer whose length is already a multiple of 4 into a Z85 string.
 *
 * @param buffer - Raw bytes; length must be divisible by 4.
 * @returns Z85-encoded string (length = buffer.length / 4 × 5).
 */
export function z85Encode(buffer: Buffer): string {
  let out = ""
  for (let i = 0; i < buffer.length; i += 4) {
    let value = buffer[i] * 16777216 + buffer[i + 1] * 65536 + buffer[i + 2] * 256 + buffer[i + 3]
    const chars = new Array(5)
    for (let j = 4; j >= 0; j--) {
      chars[j] = Z85_ALPHABET[value % 85]
      value = Math.floor(value / 85)
    }
    out += chars.join("")
  }
  return out
}

/**
 * Decode a Z85 string back to raw bytes.
 *
 * @param str - Z85 string; length must be a multiple of 5.
 * @throws If length is wrong or an unknown character appears.
 */
export function z85Decode(str: string): Buffer {
  if (str.length % 5 !== 0) throw new Error("Invalid base85 (Z85) input length.")
  const bytes: number[] = []
  for (let i = 0; i < str.length; i += 5) {
    let value = 0
    for (let j = 0; j < 5; j++) {
      const digit = Z85_ALPHABET.indexOf(str[i + j])
      if (digit === -1) throw new Error(`Invalid base85 (Z85) character: "${str[i + j]}"`)
      value = value * 85 + digit
    }
    bytes.push(
      Math.floor(value / 16777216) % 256,
      Math.floor(value / 65536) % 256,
      Math.floor(value / 256) % 256,
      value % 256,
    )
  }
  return Buffer.from(bytes)
}

/**
 * Encode arbitrary-length bytes to Z85, handling padding automatically.
 *
 * Pattern: length-prefix padding — a common technique when a codec requires
 * fixed block sizes but the payload length is arbitrary.
 */
export function encodeBase85(buffer: Buffer): string {
  const padLength = (4 - ((buffer.length + 1) % 4)) % 4
  const padded = Buffer.concat([Buffer.from([padLength]), buffer, Buffer.alloc(padLength)])
  return z85Encode(padded)
}

/**
 * Decode a Z85 string produced by {@link encodeBase85}, stripping padding.
 */
export function decodeBase85(str: string): Buffer {
  const padded = z85Decode(str)
  const padLength = padded[0]
  return padded.subarray(1, padded.length - padLength)
}
