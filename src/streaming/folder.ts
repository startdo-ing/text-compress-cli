/**
 * @module streaming/folder
 *
 * Memory-efficient folder compression pipeline.
 *
 * Large directory trees may exceed available RAM if every file is loaded
 * into a single buffer. This module streams each stage to disk:
 *
 * ```
 *   walk tree → temp archive file
 *            → stream Brotli → temp compressed file
 *            → stream encode  → output .txt (possibly split)
 * ```
 *
 * ## Pattern: staged pipeline with temp files
 *
 * Each stage reads from the previous stage's output file and writes to
 * the next, keeping peak memory bounded by chunk buffer sizes rather than
 * total archive size.
 *
 * ## Chunk sizes
 *
 * - `COPY_CHUNK` (1 MiB) — file content copied into the archive.
 * - `ENCODE_READ_CHUNK` (3 MiB) — binary read buffer for Base64 streaming.
 *   Base64 encoding is applied per-chunk for `encoding === 64`; Z85 requires
 *   the full padded buffer and is loaded once (trade-off for correctness).
 */

import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { writeDirEntry, writeFileEntry } from "../archive/format.js"
import { createMaxQualityBrotliCompress } from "../compression/brotli.js"
import { encryptBuffer } from "../crypto/password.js"
import { encodeBase64 } from "../encoding/base64.js"
import { encodeBase85 } from "../encoding/z85.js"
import { walkDirectory } from "../fs/walk.js"
import { TAG_FOLDER } from "../payload/tags.js"
import { writeEncodedOutput } from "../split/parts.js"
import type { Encoding } from "../types.js"

/** Buffer size when copying file content into the archive. */
const COPY_CHUNK = 1024 * 1024

/** Buffer size when reading compressed bytes for Base64 encoding. */
const ENCODE_READ_CHUNK = 3 * 1024 * 1024

/** Statistics collected while building the archive. */
interface ArchiveStats {
  fileCount: number
  dirCount: number
  originalBytes: number
  archiveBytes: number
}

/**
 * Depth-first walk that writes archive entries directly to a file.
 *
 * Same traversal order as `collectEntries`, but streams to disk.
 */
function buildArchiveFile(rootDir: string, archivePath: string): ArchiveStats {
  const fd = openSync(archivePath, "w")
  let fileCount = 0
  let dirCount = 0
  let originalBytes = 0

  try {
    walkDirectory(rootDir, {
      onDirectory: (_absDir, relDir) => {
        writeDirEntry(fd, relDir)
        dirCount++
      },
      onFile: (abs, rel) => {
        originalBytes += writeFileEntry(fd, rel, abs, COPY_CHUNK)
        fileCount++
      },
    })
  } finally {
    closeSync(fd)
  }

  return {
    fileCount,
    dirCount,
    originalBytes,
    archiveBytes: statSync(archivePath).size,
  }
}

/**
 * Create a readable stream that prepends the folder tag byte before file bytes.
 *
 * Pattern: **prefix transform** — prepends metadata without copying the
 * entire file into memory.
 */
function prependTagStream(tag: number, filePath: string): Readable {
  const tagBuf = Buffer.from([tag])
  const file = createReadStream(filePath)
  return Readable.from(
    (async function* () {
      yield tagBuf
      for await (const chunk of file) {
        yield chunk
      }
    })(),
  )
}

/**
 * Stream Brotli-compress a file (with tag prefix) to another file.
 */
async function brotliCompressFile(inputPath: string, outputPath: string): Promise<void> {
  await pipeline(
    prependTagStream(TAG_FOLDER, inputPath),
    createMaxQualityBrotliCompress(statSync(inputPath).size + 1),
    createWriteStream(outputPath),
  )
}

/**
 * Stream-read a binary file and write encoded text to a single output file.
 */
function encodeBinaryFileToTextFile(
  inputPath: string,
  outputPath: string,
  encoding: Encoding,
): void {
  const binaryBytes = statSync(inputPath).size
  const srcFd = openSync(inputPath, "r")

  const readAndEncode = (writeEncoded: (text: string) => void) => {
    if (encoding === 64) {
      const buf = Buffer.alloc(ENCODE_READ_CHUNK)
      let pos = 0
      while (pos < binaryBytes) {
        const toRead = Math.min(buf.length, binaryBytes - pos)
        const n = readSync(srcFd, buf, 0, toRead, pos)
        if (n <= 0) break
        writeEncoded(encodeBase64(buf.subarray(0, n)))
        pos += n
      }
    } else {
      const raw = Buffer.alloc(binaryBytes)
      let pos = 0
      while (pos < binaryBytes) {
        const n = readSync(srcFd, raw, pos, binaryBytes - pos, pos)
        if (n <= 0) break
        pos += n
      }
      writeEncoded(encodeBase85(raw))
    }
  }

  const outFd = openSync(outputPath, "w")
  try {
    readAndEncode((text) => writeSync(outFd, text))
  } finally {
    closeSync(srcFd)
    closeSync(outFd)
  }
}

/** Result of {@link compressFolderToPath}. */
export interface CompressFolderToPathResult extends ArchiveStats {
  outputPaths: string[]
  compressedBytes: number
  splitChunkSize?: number
}

/**
 * Compress a folder to encoded text file(s) using the streaming pipeline.
 *
 * Creates a temporary working directory that is always cleaned up in `finally`.
 */
export async function compressFolderToPath(
  dirPath: string,
  outputPath: string,
  encoding: Encoding = 64,
  split?: number,
  password?: string,
): Promise<CompressFolderToPathResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "text-compress-"))
  const archivePath = join(tempDir, "archive.bin")
  const compressedPath = join(tempDir, "compressed.bin")

  try {
    const stats = buildArchiveFile(dirPath, archivePath)
    await brotliCompressFile(archivePath, compressedPath)
    let encodeInputPath = compressedPath
    if (password) {
      const encryptedPath = join(tempDir, "encrypted.bin")
      writeFileSync(encryptedPath, encryptBuffer(readFileSync(compressedPath), password))
      encodeInputPath = encryptedPath
    }
    const compressedBytes = statSync(encodeInputPath).size
    const encodedPath = join(tempDir, "encoded.txt")
    encodeBinaryFileToTextFile(encodeInputPath, encodedPath, encoding)
    const encoded = readFileSync(encodedPath, "utf-8")
    const { paths: outputPaths, splitChunkSize } = writeEncodedOutput(encoded, outputPath, split)
    return { ...stats, compressedBytes, outputPaths, splitChunkSize }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
