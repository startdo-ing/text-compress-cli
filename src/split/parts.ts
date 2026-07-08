/**
 * @module split/parts
 *
 * Split-file I/O for oversized compressed strings.
 *
 * Chat platforms and some editors impose character limits (~30 000–50 000).
 * This module splits a long encoded string into numbered part files and
 * reassembles them on read.
 *
 * ## v2 split format
 *
 * Each logical part is prefixed with a 12-byte header so order is encoded in
 * file content, not filenames:
 *
 * ```
 *   [magic: "TCP\x02"][partIndex: u32le][totalParts: u32le][payload…]
 * ```
 *
 * Every part carries `totalParts`, so any single valid part reveals how many
 * logical parts exist. A physical file may contain one or more consecutive
 * parts. Parts can be read in any file order, and adjacent part files can be
 * merged into fewer files.
 *
 * ## Compress naming (unchanged)
 *
 * ```
 *   output.txt  →  output.1.txt, output.2.txt, … output.12.txt
 *   archive     →  archive.1, archive.2, …
 * ```
 *
 * Zero-padding width matches the total part count so lexical sort equals
 * numeric sort (`output.02.txt` before `output.10.txt`).
 *
 * ## Decompress discovery
 *
 * Pass **any** sibling file. All files sharing the same prefix — the basename
 * segment before the **first** `.` — are scanned (`file.1.md`, `file.7.txt`,
 * … → prefix `file`). Extension and the numeric segment in the filename are
 * ignored. Files without valid split headers are skipped.
 *
 * ## Auto-split threshold
 *
 * When no explicit `-s` size is given, outputs longer than
 * {@link AUTO_SPLIT_CHARS} are automatically split.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

/** Default character threshold for automatic output splitting. */
export const AUTO_SPLIT_CHARS = 30_000

/** Magic bytes identifying a v2 split chunk header. */
export const SPLIT_MAGIC = Buffer.from([0x54, 0x43, 0x50, 0x02])

const SPLIT_HEADER_SIZE = 12

/** One parsed logical part from split file content. */
export interface SplitChunk {
  partIndex: number
  totalParts: number
  payload: string
}

/**
 * Decide whether and how to split encoded output.
 *
 * @param encodedLength - Total characters in the encoded string.
 * @param explicitSplit - User-provided `-s` value, if any.
 * @returns Chunk size, or `undefined` when no split is needed.
 */
export function resolveSplitChunkSize(
  encodedLength: number,
  explicitSplit?: number,
): number | undefined {
  if (explicitSplit !== undefined) return explicitSplit
  if (encodedLength > AUTO_SPLIT_CHARS) return AUTO_SPLIT_CHARS
  return undefined
}

/**
 * Split a string into fixed-size chunks (last chunk may be shorter).
 *
 * @throws If `chunkSize` is not a positive integer.
 */
export function splitString(value: string, chunkSize: number): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`Split size must be a positive integer, got ${chunkSize}.`)
  }
  if (value.length === 0) return [""]

  const chunks: string[] = []
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize))
  }
  return chunks
}

/** Build the 12-byte v2 split chunk header. */
export function createSplitChunkHeader(partIndex: number, totalParts: number): Buffer {
  const header = Buffer.alloc(SPLIT_HEADER_SIZE)
  SPLIT_MAGIC.copy(header, 0)
  header.writeUInt32LE(partIndex, 4)
  header.writeUInt32LE(totalParts, 8)
  return header
}

/**
 * Wrap one encoded payload chunk with a v2 split header.
 */
export function wrapSplitChunk(partIndex: number, totalParts: number, payload: string): string {
  return Buffer.concat([
    createSplitChunkHeader(partIndex, totalParts),
    Buffer.from(payload, "utf-8"),
  ]).toString("utf-8")
}

function readSplitChunks(buf: Buffer): SplitChunk[] {
  const chunks: SplitChunk[] = []
  let offset = 0

  while (offset < buf.length) {
    if (buf.length - offset < SPLIT_HEADER_SIZE) {
      throw new Error("Invalid split format: truncated chunk header.")
    }
    if (!buf.subarray(offset, offset + SPLIT_MAGIC.length).equals(SPLIT_MAGIC)) {
      throw new Error("Invalid split format: unexpected data between split chunks.")
    }

    const partIndex = buf.readUInt32LE(offset + 4)
    const totalParts = buf.readUInt32LE(offset + 8)
    offset += SPLIT_HEADER_SIZE

    const nextMagic = buf.indexOf(SPLIT_MAGIC, offset)
    const end = nextMagic === -1 ? buf.length : nextMagic
    const payload = buf.subarray(offset, end).toString("utf-8")
    chunks.push({ partIndex, totalParts, payload })
    offset = end
  }

  return chunks
}

/**
 * Parse split chunks from a buffer when it starts with a split header.
 *
 * @returns `null` when the buffer is not split data or is malformed.
 */
export function tryParseSplitChunks(buf: Buffer): SplitChunk[] | null {
  if (buf.length < SPLIT_HEADER_SIZE) return null
  if (!buf.subarray(0, SPLIT_MAGIC.length).equals(SPLIT_MAGIC)) return null
  try {
    return readSplitChunks(buf)
  } catch {
    return null
  }
}

/**
 * Parse all logical parts from one file's bytes.
 *
 * Files without a leading split header are treated as a single unsplit payload.
 */
export function parseSplitBuffer(buf: Buffer): SplitChunk[] {
  if (buf.length === 0) {
    return [{ partIndex: 1, totalParts: 1, payload: "" }]
  }

  const splitChunks = tryParseSplitChunks(buf)
  if (splitChunks) return splitChunks

  return [{ partIndex: 1, totalParts: 1, payload: buf.toString("utf-8") }]
}

/**
 * Reassemble logical parts into one encoded string.
 *
 * Uses `totalParts` from the chunk headers — any valid part reveals the full count.
 *
 * @throws If parts are missing, duplicated, or disagree on total count.
 */
export function assembleSplitChunks(chunks: SplitChunk[]): string {
  if (chunks.length === 0) {
    throw new Error("No split chunks found.")
  }

  if (chunks.length === 1 && chunks[0].totalParts === 1) {
    return chunks[0].payload
  }

  const totalParts = chunks[0].totalParts
  const byIndex = new Map<number, string>()

  for (const chunk of chunks) {
    if (chunk.totalParts !== totalParts) {
      throw new Error("Split parts disagree on total part count.")
    }
    if (!Number.isInteger(chunk.partIndex) || chunk.partIndex < 1 || chunk.partIndex > totalParts) {
      throw new Error(`Invalid split part index ${chunk.partIndex}.`)
    }
    if (byIndex.has(chunk.partIndex)) {
      throw new Error(`Duplicate split part ${chunk.partIndex}.`)
    }
    byIndex.set(chunk.partIndex, chunk.payload)
  }

  const parts: string[] = []
  for (let i = 1; i <= totalParts; i++) {
    const payload = byIndex.get(i)
    if (payload === undefined) {
      throw new Error(`Missing split part ${i}.`)
    }
    parts.push(payload)
  }

  return parts.join("")
}

/**
 * Build the filesystem path for one part of a split output.
 *
 * Inserts `.<paddedIndex>` before the file extension.
 */
export function formatSplitOutputPath(
  outputPath: string,
  partIndex: number,
  totalParts: number,
): string {
  const part = String(partIndex).padStart(String(totalParts).length, "0")
  const slash = Math.max(outputPath.lastIndexOf("/"), outputPath.lastIndexOf("\\"))
  const dot = outputPath.lastIndexOf(".")
  const hasExtension = dot > slash

  if (hasExtension) {
    return `${outputPath.slice(0, dot)}.${part}${outputPath.slice(dot)}`
  }
  return `${outputPath}.${part}`
}

/** Basename segment before the first `.` — used to group split siblings on read. */
export function extractFilenamePrefix(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  const name = filePath.slice(slash + 1)
  const dot = name.indexOf(".")
  if (dot <= 0) return name
  return name.slice(0, dot)
}

/**
 * Return the filename prefix used to discover split siblings.
 *
 * @deprecated Use {@link extractFilenamePrefix} instead.
 */
export function parseSplitPartPath(filePath: string): { prefix: string } {
  return { prefix: extractFilenamePrefix(filePath) }
}

/** List regular files in `dir` whose names start with `prefix.`. */
function listPrefixSiblingPaths(dir: string, prefix: string): string[] {
  const marker = `${prefix}.`
  return readdirSync(dir)
    .filter((name) => name.startsWith(marker))
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * Resolve an input path to all prefix-sibling part files in the same directory.
 *
 * Any sibling may be passed; discovery uses the prefix before the first `.`.
 * Falls back to the input file alone when no `prefix.*` siblings exist.
 */
export function resolveSplitInputPaths(inputPath: string): string[] {
  if (existsSync(inputPath)) {
    const stat = statSync(inputPath)
    if (stat.isDirectory()) {
      throw new Error(
        `"${inputPath}" is a directory, not a compressed file. Pass the compressed .txt file.`,
      )
    }
    if (!stat.isFile()) {
      throw new Error(`Cannot read "${inputPath}": not a regular file.`)
    }
  }

  const dir = dirname(inputPath)
  const prefix = extractFilenamePrefix(inputPath)
  const siblings = listPrefixSiblingPaths(dir, prefix)
  if (siblings.length > 0) return siblings

  if (existsSync(inputPath) && statSync(inputPath).isFile()) {
    return [inputPath]
  }

  throw new Error(`Input file not found: ${inputPath}`)
}

/**
 * Read and concatenate all parts for a split (or single) compressed input.
 *
 * Scans every prefix sibling, skips files without valid split headers, and
 * reassembles using embedded part indices and `totalParts`. When no sibling
 * contains split headers, reads the requested path as a single unsplit file.
 */
export function readSplitInput(inputPath: string): {
  content: string
  partPaths: string[]
} {
  const partPaths = resolveSplitInputPaths(inputPath)
  const chunks: SplitChunk[] = []

  for (const path of partPaths) {
    const parsed = tryParseSplitChunks(readFileSync(path))
    if (parsed) chunks.push(...parsed)
  }

  if (chunks.length > 0) {
    const content = assembleSplitChunks(chunks)
    return { content, partPaths }
  }

  if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
    throw new Error(`No valid split parts found for prefix "${extractFilenamePrefix(inputPath)}".`)
  }

  const content = assembleSplitChunks(parseSplitBuffer(readFileSync(inputPath)))
  return { content, partPaths: [inputPath] }
}
