/**
 * @module archive/unpack
 *
 * Restore a folder archive from binary data to the filesystem.
 *
 * Iterates deserialized entries and creates directories / writes files.
 * Parent directories are created on demand (`mkdirSync` with `recursive`).
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { deserializeArchive } from "./format.js"

/**
 * Unpack a binary archive buffer into a destination directory.
 *
 * @param buffer - Serialized archive bytes (not Brotli-compressed).
 * @param destDir - Where to recreate the folder tree.
 * @returns Counts of files, directories, and total bytes restored.
 */
export function unpackDirectory(
  buffer: Buffer,
  destDir: string,
): { files: number; dirs: number; bytes: number } {
  mkdirSync(destDir, { recursive: true })
  const entries = deserializeArchive(buffer)

  let files = 0
  let dirs = 0
  let bytes = 0
  for (const entry of entries) {
    const destPath = join(destDir, ...entry.relPath.split("/"))
    if (entry.type === "d") {
      mkdirSync(destPath, { recursive: true })
      dirs++
    } else {
      mkdirSync(dirname(destPath), { recursive: true })
      const content = entry.content ?? Buffer.alloc(0)
      writeFileSync(destPath, content)
      files++
      bytes += content.length
    }
  }
  return { files, dirs, bytes }
}
