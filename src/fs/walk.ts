/**
 * @module fs/walk
 *
 * Shared depth-first directory walker used by in-memory and streaming
 * folder compression. Applies `.gitignore` rules when enabled.
 */

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { GitignoreFilter } from "./gitignore.js"

export interface DirectoryWalkHandlers {
  /** Called for every directory except the compression root (`relDir === ""`). */
  onDirectory?: (absDir: string, relDir: string) => void
  onFile: (absPath: string, relPath: string) => void
}

/**
 * Walk `rootDir` depth-first with sorted children.
 *
 * @param rootDir - Absolute path to the folder root.
 * @param handlers - Callbacks for directories and files.
 * @param options.useGitignore - Apply `.gitignore` rules (default: true).
 */
export function walkDirectory(
  rootDir: string,
  handlers: DirectoryWalkHandlers,
  options: { useGitignore?: boolean } = {},
): void {
  const useGitignore = options.useGitignore !== false
  const filter = useGitignore ? new GitignoreFilter(rootDir) : null

  function walk(absDir: string, relDir: string): void {
    filter?.enterDirectory(absDir)
    try {
      if (relDir !== "") handlers.onDirectory?.(absDir, relDir)

      const dirents = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      for (const dirent of dirents) {
        const abs = join(absDir, dirent.name)
        const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name
        const isDirectory = dirent.isDirectory()
        const isFile = dirent.isFile()

        if (!isDirectory && !isFile) continue
        if (filter?.isIgnored(abs, isDirectory)) continue

        if (isDirectory) {
          walk(abs, rel)
        } else {
          handlers.onFile(abs, rel)
        }
      }
    } finally {
      filter?.leaveDirectory(absDir)
    }
  }

  walk(rootDir, "")
}
