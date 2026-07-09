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
 * Each logical part is prefixed with a short ASCII header so order is encoded
 * in file content, not filenames. The header uses only printable text (no NUL
 * or control bytes) so split files stay pasteable and open in any text editor:
 *
 * ```
 *   ;TCP2;<partIndex>;<totalParts>;<payload…>
 * ```
 *
 * Legacy v2.0.x files used a 12-byte binary header (`TCP\x02` + u32le fields);
 * those are still accepted on read.
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
 * {@link AUTO_SPLIT_CHARS} are automatically split. Split limits count the
 * entire part file, including the `;TCP2;` header — not just the payload.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** Default character threshold for automatic output splitting. */
export const AUTO_SPLIT_CHARS = 30_000

/** ASCII prefix identifying a v2 split chunk header. */
export const SPLIT_MAGIC = ";TCP2;"

/** Legacy binary magic from v2.0.x (still accepted on read). */
const LEGACY_SPLIT_MAGIC = Buffer.from([0x54, 0x43, 0x50, 0x02])

const LEGACY_SPLIT_HEADER_SIZE = 12

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
 * @returns Max characters per part file (header + payload), or `undefined` when no split is needed.
 */
export function resolveSplitChunkSize(
  encodedLength: number,
  explicitSplit?: number,
): number | undefined {
  if (explicitSplit !== undefined) return explicitSplit
  if (encodedLength > AUTO_SPLIT_CHARS) return AUTO_SPLIT_CHARS
  return undefined
}

/** Character length of the split header for one part. */
export function splitHeaderLength(partIndex: number, totalParts: number): number {
  return createSplitChunkHeader(partIndex, totalParts).length
}

/** Smallest allowed `-s` value (header-only part for a single-part output). */
export function minSplitPartChars(): number {
  return splitHeaderLength(1, 1)
}

function assertSplitPartChars(maxPartChars: number): void {
  const min = minSplitPartChars()
  if (!Number.isInteger(maxPartChars) || maxPartChars < min) {
    throw new Error(`Split size must be at least ${min} characters (to fit split headers).`)
  }
}

function countSplitParts(
  encodedLength: number,
  maxPartChars: number,
  totalPartsGuess: number,
): number {
  if (encodedLength === 0) return 1

  let offset = 0
  let partIndex = 0
  while (offset < encodedLength) {
    partIndex++
    const payloadCap = maxPartChars - splitHeaderLength(partIndex, totalPartsGuess)
    if (payloadCap < 1) {
      throw new Error(
        `Split size ${maxPartChars} is too small for ${totalPartsGuess} parts (header alone is ${splitHeaderLength(partIndex, totalPartsGuess)} characters).`,
      )
    }
    offset += Math.min(payloadCap, encodedLength - offset)
  }
  return partIndex
}

/**
 * Resolve how many part files are needed when each file is at most `maxPartChars`.
 *
 * Iterates until the guessed `totalParts` matches the count implied by header sizes.
 */
export function resolveSplitPartCount(encodedLength: number, maxPartChars: number): number {
  assertSplitPartChars(maxPartChars)
  if (encodedLength === 0) return 1

  let totalParts = 1
  for (let i = 0; i < 20; i++) {
    const next = countSplitParts(encodedLength, maxPartChars, totalParts)
    if (next === totalParts) return totalParts
    totalParts = next
  }
  return totalParts
}

/**
 * Split encoded text into wrapped part strings, each at most `maxPartChars` long.
 */
export function splitEncodedIntoWrappedParts(encoded: string, maxPartChars: number): string[] {
  assertSplitPartChars(maxPartChars)
  const totalParts = resolveSplitPartCount(encoded.length, maxPartChars)
  const parts: string[] = []
  let offset = 0

  for (let partIndex = 1; partIndex <= totalParts; partIndex++) {
    const payloadCap = maxPartChars - splitHeaderLength(partIndex, totalParts)
    const payload = encoded.slice(offset, offset + payloadCap)
    const wrapped = wrapSplitChunk(partIndex, totalParts, payload)
    if (wrapped.length > maxPartChars) {
      throw new Error(
        `Split part ${partIndex} is ${wrapped.length} characters, exceeding limit ${maxPartChars}.`,
      )
    }
    parts.push(wrapped)
    offset += payload.length
  }

  return parts
}

/**
 * Write encoded text to one file or numbered split part files.
 */
export function writeEncodedOutput(
  encoded: string,
  outputPath: string,
  explicitSplit?: number,
): { paths: string[]; splitChunkSize?: number } {
  const maxPartChars = resolveSplitChunkSize(encoded.length, explicitSplit)
  if (maxPartChars === undefined) {
    writeFileSync(outputPath, encoded, "utf-8")
    return { paths: [outputPath] }
  }

  const wrappedParts = splitEncodedIntoWrappedParts(encoded, maxPartChars)
  const totalParts = wrappedParts.length
  const paths = wrappedParts.map((content, index) => {
    const partPath = formatSplitOutputPath(outputPath, index + 1, totalParts)
    writeFileSync(partPath, content, "utf-8")
    return partPath
  })
  return { paths, splitChunkSize: maxPartChars }
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

/** Build the ASCII v2 split chunk header. */
export function createSplitChunkHeader(partIndex: number, totalParts: number): string {
  return `${SPLIT_MAGIC}${partIndex};${totalParts};`
}

/**
 * Wrap one encoded payload chunk with a v2 split header.
 */
export function wrapSplitChunk(partIndex: number, totalParts: number, payload: string): string {
  return `${createSplitChunkHeader(partIndex, totalParts)}${payload}`
}

function parseTextSplitHeader(
  text: string,
  offset: number,
): { partIndex: number; totalParts: number; headerEnd: number } | null {
  if (!text.startsWith(SPLIT_MAGIC, offset)) return null

  let pos = offset + SPLIT_MAGIC.length
  const partEnd = text.indexOf(";", pos)
  if (partEnd === -1) return null

  const partIndex = Number(text.slice(pos, partEnd))
  pos = partEnd + 1
  const totalEnd = text.indexOf(";", pos)
  if (totalEnd === -1) return null

  const totalParts = Number(text.slice(pos, totalEnd))
  if (
    !Number.isInteger(partIndex) ||
    !Number.isInteger(totalParts) ||
    partIndex < 1 ||
    totalParts < 1
  ) {
    return null
  }

  return { partIndex, totalParts, headerEnd: totalEnd + 1 }
}

function readTextSplitChunks(text: string): SplitChunk[] {
  const chunks: SplitChunk[] = []
  let offset = 0

  while (offset < text.length) {
    const header = parseTextSplitHeader(text, offset)
    if (!header) {
      throw new Error("Invalid split format: unexpected data between split chunks.")
    }

    const nextMagic = text.indexOf(SPLIT_MAGIC, header.headerEnd)
    const end = nextMagic === -1 ? text.length : nextMagic
    chunks.push({
      partIndex: header.partIndex,
      totalParts: header.totalParts,
      payload: text.slice(header.headerEnd, end),
    })
    offset = end
  }

  return chunks
}

function readLegacyBinarySplitChunks(buf: Buffer): SplitChunk[] {
  const chunks: SplitChunk[] = []
  let offset = 0

  while (offset < buf.length) {
    if (buf.length - offset < LEGACY_SPLIT_HEADER_SIZE) {
      throw new Error("Invalid split format: truncated chunk header.")
    }
    if (!buf.subarray(offset, offset + LEGACY_SPLIT_MAGIC.length).equals(LEGACY_SPLIT_MAGIC)) {
      throw new Error("Invalid split format: unexpected data between split chunks.")
    }

    const partIndex = buf.readUInt32LE(offset + 4)
    const totalParts = buf.readUInt32LE(offset + 8)
    offset += LEGACY_SPLIT_HEADER_SIZE

    const nextMagic = buf.indexOf(LEGACY_SPLIT_MAGIC, offset)
    const end = nextMagic === -1 ? buf.length : nextMagic
    const payload = buf.subarray(offset, end).toString("utf-8")
    chunks.push({ partIndex, totalParts, payload })
    offset = end
  }

  return chunks
}

function readSplitChunks(buf: Buffer): SplitChunk[] {
  if (buf.subarray(0, SPLIT_MAGIC.length).toString("utf-8") === SPLIT_MAGIC) {
    return readTextSplitChunks(buf.toString("utf-8"))
  }
  if (buf.subarray(0, LEGACY_SPLIT_MAGIC.length).equals(LEGACY_SPLIT_MAGIC)) {
    return readLegacyBinarySplitChunks(buf)
  }
  throw new Error("Invalid split format: missing chunk header.")
}

/**
 * Parse split chunks from a buffer when it starts with a split header.
 *
 * @returns `null` when the buffer is not split data or is malformed.
 */
export function tryParseSplitChunks(buf: Buffer): SplitChunk[] | null {
  if (buf.length < SPLIT_MAGIC.length) return null
  const startsWithText = buf.subarray(0, SPLIT_MAGIC.length).toString("utf-8") === SPLIT_MAGIC
  const startsWithLegacy = buf.subarray(0, LEGACY_SPLIT_MAGIC.length).equals(LEGACY_SPLIT_MAGIC)
  if (!startsWithText && !startsWithLegacy) return null
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
