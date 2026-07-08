/**
 * @module api/folder
 *
 * High-level API for folder compression and decompression.
 *
 * ## In-memory path (`compressFolder`)
 *
 * Walks the tree, builds a binary archive in RAM, compresses, and encodes.
 * Suitable for small-to-medium folders.
 *
 * ## Decompression (`decompressToPath`)
 *
 * Decodes, decompresses, checks the folder tag, and unpacks to disk.
 */

import { collectEntries } from "../archive/collect.js"
import { serializeArchive } from "../archive/format.js"
import { unpackDirectory } from "../archive/unpack.js"
import { compressTaggedPayload, decompressPayload, TAG_FOLDER } from "../payload/tags.js"
import type { Encoding } from "../types.js"

/**
 * Pack a directory tree into a single encoded string (in-memory).
 *
 * @returns Encoded blob plus statistics about the source folder.
 */
export function compressFolder(dirPath: string, encoding: Encoding = 64, password?: string) {
  const entries = collectEntries(dirPath)
  const archive = serializeArchive(entries)
  const encoded = compressTaggedPayload(TAG_FOLDER, archive, encoding, password)
  const files = entries.filter((e) => e.type === "f")
  const originalBytes = files.reduce((sum, e) => sum + (e.content?.length ?? 0), 0)
  return {
    encoded,
    fileCount: files.length,
    dirCount: entries.length - files.length,
    originalBytes,
    archiveBytes: archive.length,
  }
}

/**
 * Decode and unpack a folder archive to a destination directory.
 *
 * @throws If the payload is text, not a folder archive.
 */
export function decompressToPath(
  encoded: string,
  destDir: string,
  encoding: Encoding = 64,
  password?: string,
) {
  const { tag, data } = decompressPayload(encoded, encoding, password)
  if (tag !== TAG_FOLDER) {
    throw new Error("This payload is compressed text, not a folder. Use decompress.")
  }
  return unpackDirectory(data, destDir)
}
