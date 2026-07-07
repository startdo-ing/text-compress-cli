/**
 * @module archive/collect
 *
 * In-memory directory tree walker that produces a flat {@link ArchiveEntry}
 * list suitable for {@link serializeArchive}.
 *
 * ## Traversal algorithm
 *
 * Depth-first pre-order walk with sorted children:
 *
 * 1. Emit a directory marker for every non-root directory.
 * 2. For each child (sorted by `localeCompare`), recurse into subdirs or
 *    read file content into memory.
 * 3. Skip paths excluded by `.gitignore` rules (outside → inside).
 *
 * This path loads every file into RAM — use the streaming builder in
 * `streaming/folder.ts` for large directory trees.
 */

import { readFileSync } from "node:fs"
import { walkDirectory } from "../fs/walk.js"
import type { ArchiveEntry } from "./types.js"

/**
 * Walk a directory tree and collect all entries into a flat array.
 *
 * @param rootDir - Absolute path to the folder root.
 */
export function collectEntries(rootDir: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []

  walkDirectory(rootDir, {
    onDirectory: (_absDir, relDir) => {
      entries.push({ type: "d", relPath: relDir })
    },
    onFile: (abs, rel) => {
      entries.push({ type: "f", relPath: rel, content: readFileSync(abs) })
    },
  })

  return entries
}
