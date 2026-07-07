/**
 * @module archive/format
 *
 * Binary serialization and deserialization for folder archives.
 *
 * ## Wire format
 *
 * A flat sequence of length-prefixed entries (little-endian u32 lengths):
 *
 * ```
 *   directory: [0x44] [pathLen: u32le] [path utf-8 bytes]
 *   file:      [0x46] [pathLen: u32le] [path utf-8] [contentLen: u32le] [content bytes]
 * ```
 *
 * Paths are POSIX-style (forward slashes) and relative to the archive root.
 * File metadata (permissions, timestamps, symlinks) is intentionally dropped
 * to keep the format minimal and deterministic.
 *
 * ## Design choices
 *
 * - **Flat list vs tree** — A pre-order walk produces a flat list that is
 *   trivial to stream to disk without building an in-memory tree.
 * - **Little-endian u32** — Matches Node's `writeUInt32LE`; portable across
 *   all platforms this library targets.
 * - **Sorted children** — `collectEntries` sorts directory entries by name
 *   so the same folder always produces the same byte sequence (deterministic
 *   output aids testing and deduplication).
 *
 * ## Security
 *
 * `deserializeArchive` rejects paths containing `..` or starting with `/`
 * to prevent zip-slip style directory traversal on unpack.
 */

import { closeSync, openSync, readSync, statSync, writeSync } from "node:fs"
import { type ArchiveEntry, ENTRY_DIR, ENTRY_FILE } from "./types.js"

/**
 * Serialize an array of archive entries into a single binary buffer.
 *
 * @param entries - Flat list from `collectEntries` or manual construction.
 */
export function serializeArchive(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const pathBuf = Buffer.from(entry.relPath, "utf-8")
    const pathLenBuf = Buffer.alloc(4)
    pathLenBuf.writeUInt32LE(pathBuf.length, 0)

    if (entry.type === "d") {
      chunks.push(Buffer.from([ENTRY_DIR]), pathLenBuf, pathBuf)
    } else {
      const content = entry.content ?? Buffer.alloc(0)
      const contentLenBuf = Buffer.alloc(4)
      contentLenBuf.writeUInt32LE(content.length, 0)
      chunks.push(Buffer.from([ENTRY_FILE]), pathLenBuf, pathBuf, contentLenBuf, content)
    }
  }
  return Buffer.concat(chunks)
}

/**
 * Parse a binary archive buffer back into entry objects.
 *
 * @throws On unknown type bytes, truncated data, or unsafe paths.
 */
export function deserializeArchive(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  let offset = 0
  while (offset < buffer.length) {
    const type = buffer[offset]
    offset += 1
    const pathLen = buffer.readUInt32LE(offset)
    offset += 4
    const relPath = buffer.subarray(offset, offset + pathLen).toString("utf-8")
    offset += pathLen

    if (relPath.startsWith("/") || relPath.split("/").includes("..")) {
      throw new Error(`Unsafe path in archive: "${relPath}"`)
    }

    if (type === ENTRY_DIR) {
      entries.push({ type: "d", relPath })
    } else if (type === ENTRY_FILE) {
      const contentLen = buffer.readUInt32LE(offset)
      offset += 4
      const content = buffer.subarray(offset, offset + contentLen)
      offset += contentLen
      entries.push({ type: "f", relPath, content })
    } else {
      throw new Error(`Corrupt archive: unknown entry type byte 0x${type.toString(16)}`)
    }
  }
  return entries
}

/**
 * Write a single directory entry to an open file descriptor.
 *
 * Used by the streaming archive builder to avoid buffering the entire
 * archive in memory.
 */
export function writeDirEntry(fd: number, relPath: string): void {
  const pathBuf = Buffer.from(relPath, "utf-8")
  const pathLenBuf = Buffer.alloc(4)
  pathLenBuf.writeUInt32LE(pathBuf.length, 0)
  writeSync(fd, Buffer.from([ENTRY_DIR]))
  writeSync(fd, pathLenBuf)
  writeSync(fd, pathBuf)
}

/**
 * Write a single file entry to an open file descriptor, streaming content
 * from disk in chunks.
 *
 * @param copyChunkSize - Read buffer size for streaming file content.
 * @returns Number of content bytes written.
 */
export function writeFileEntry(
  fd: number,
  relPath: string,
  filePath: string,
  copyChunkSize: number,
): number {
  const pathBuf = Buffer.from(relPath, "utf-8")
  const pathLenBuf = Buffer.alloc(4)
  pathLenBuf.writeUInt32LE(pathBuf.length, 0)
  const contentLen = statSync(filePath).size
  const contentLenBuf = Buffer.alloc(4)
  contentLenBuf.writeUInt32LE(contentLen, 0)

  writeSync(fd, Buffer.from([ENTRY_FILE]))
  writeSync(fd, pathLenBuf)
  writeSync(fd, pathBuf)
  writeSync(fd, contentLenBuf)

  const srcFd = openSync(filePath, "r")
  try {
    const buf = Buffer.alloc(copyChunkSize)
    let copied = 0
    while (copied < contentLen) {
      const toRead = Math.min(buf.length, contentLen - copied)
      const n = readSync(srcFd, buf, 0, toRead, copied)
      if (n <= 0) break
      writeSync(fd, buf, 0, n)
      copied += n
    }
  } finally {
    closeSync(srcFd)
  }

  return contentLen
}
