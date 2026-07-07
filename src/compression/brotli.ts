/**
 * @module compression/brotli
 *
 * Brotli compression wrappers around Node.js `zlib`.
 *
 * ## Why Brotli?
 *
 * Brotli (RFC 7932) is a modern LZ77 + Huffman + context-modelling codec
 * developed by Google. For text and source code it typically beats gzip and
 * deflate by 15–25 % at comparable speed. We always use maximum quality
 * because this tool optimises for smallest output, not speed.
 *
 * ## Parameters
 *
 * | Parameter          | Value              | Effect                          |
 * |--------------------|--------------------|---------------------------------|
 * | `QUALITY`          | `BROTLI_MAX_QUALITY` (11) | Best ratio, slowest      |
 * | `LGWIN`            | `BROTLI_MAX_WINDOW_BITS`   | Largest LZ77 window      |
 * | `SIZE_HINT`        | input byte length  | Helps encoder pre-allocate      |
 *
 * ## Sync vs streaming
 *
 * - `brotliCompress` — in-memory, used by the library API for text and
 *   small folder archives loaded entirely into RAM.
 * - `createMaxQualityBrotliCompress` — streaming transform, used when
 *   compressing large folder archives without loading them into memory.
 *
 * @see https://github.com/google/brotli — reference implementation
 */

import { brotliCompressSync, createBrotliCompress, constants as zlibConstants } from "node:zlib"

/** Shared Brotli parameters for maximum compression ratio. */
function maxQualityParams(sizeHint: number) {
  return {
    [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
    [zlibConstants.BROTLI_PARAM_LGWIN]: zlibConstants.BROTLI_MAX_WINDOW_BITS,
    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: sizeHint,
  }
}

/**
 * Compress a buffer synchronously (in-memory path).
 *
 * Suitable for text payloads and folder archives that fit in RAM.
 */
export function brotliCompress(input: Buffer): Buffer {
  return brotliCompressSync(input, { params: maxQualityParams(input.length) })
}

/**
 * Create a streaming Brotli compressor transform.
 *
 * Used by the folder streaming pipeline: archive bytes flow through this
 * transform into a file on disk without ever being fully buffered.
 */
export function createMaxQualityBrotliCompress(sizeHint: number) {
  return createBrotliCompress({ params: maxQualityParams(sizeHint) })
}
