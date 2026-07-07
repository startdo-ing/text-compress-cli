/**
 * @module fs/paths
 *
 * Filesystem path validation and safe file reading.
 *
 * Centralises stat/read error handling so CLI and library callers get
 * consistent, actionable error messages (e.g. distinguishing "path is a
 * directory" from "path not found").
 */

import { readFileSync, statSync } from "node:fs"

/**
 * Stat a path, translating ENOENT into a friendly error message.
 */
function statPath(path: string) {
  try {
    return statSync(path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      throw new Error(`Path not found: ${path}`)
    }
    throw err
  }
}

/**
 * Assert that a path exists and is a directory.
 *
 * @throws If the path is a file or does not exist.
 */
export function assertDirectory(path: string): void {
  const stat = statPath(path)
  if (!stat.isDirectory()) {
    throw new Error(`"${path}" is not a directory. Pass a file path instead.`)
  }
}

/**
 * Read a UTF-8 text file with context-aware error messages.
 *
 * @param purpose - `"compress"` vs `"decompress"` changes the directory hint.
 */
export function readTextFile(
  path: string,
  purpose: "compress" | "decompress" = "compress",
): string {
  const stat = statPath(path)
  if (stat.isDirectory()) {
    const hint =
      purpose === "decompress"
        ? "Pass the compressed .txt file, not a decompressed output folder."
        : "Pass a folder path to compress a directory, or a file path for a single file."
    throw new Error(`"${path}" is a directory, not a file. ${hint}`)
  }
  if (!stat.isFile()) {
    throw new Error(`Cannot read "${path}": not a regular file.`)
  }
  return readFileSync(path, "utf-8")
}
