/**
 * @module cli/version
 *
 * Package version read from package.json at runtime.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

let cachedVersion: string | undefined

/** Return the published `text-compress` version string. */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }
  cachedVersion = pkg.version
  return cachedVersion
}
