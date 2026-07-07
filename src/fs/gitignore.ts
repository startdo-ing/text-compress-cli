/**
 * @module fs/gitignore
 *
 * Git-style `.gitignore` filtering for directory walks.
 *
 * Rules are applied **outside → inside**:
 *
 * 1. If the tree is inside a git repo, load every `.gitignore` on the path
 *    from the repo root down to (but not including) the compression root.
 * 2. While walking, load each directory's `.gitignore` before visiting
 *    children and drop it when leaving the directory.
 *
 * Later rules can negate earlier ones, matching git's behaviour.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import ignore, { type Ignore } from "ignore"

interface IgnoreLayer {
  baseDir: string
  matcher: Ignore
}

function readGitignoreFile(absDir: string): Ignore | null {
  const gitignorePath = join(absDir, ".gitignore")
  if (!existsSync(gitignorePath)) return null
  return ignore().add(readFileSync(gitignorePath, "utf-8"))
}

/** Walk upward until a `.git` directory is found; return that path or null. */
function findGitRoot(dir: string): string | null {
  let current = resolve(dir)
  while (true) {
    if (existsSync(join(current, ".git"))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** Directories on the path from `from` up to but excluding `to`. */
function ancestorDirs(from: string, to: string): string[] {
  const ancestors: string[] = []
  let current = resolve(from)
  const target = resolve(to)
  while (current !== target) {
    ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return ancestors
}

/**
 * Stateful filter that accumulates `.gitignore` rules while descending
 * a directory tree.
 */
export class GitignoreFilter {
  private readonly layers: IgnoreLayer[] = []

  constructor(rootDir: string) {
    const gitRoot = findGitRoot(rootDir)
    const ancestorRoot = gitRoot ?? resolve(rootDir)
    for (const dir of ancestorDirs(ancestorRoot, rootDir)) {
      this.pushLayer(dir)
    }
  }

  /** Load `.gitignore` for `absDir` if present. */
  enterDirectory(absDir: string): void {
    this.pushLayer(absDir)
  }

  /** Remove rules loaded for `absDir`. */
  leaveDirectory(absDir: string): void {
    const resolved = resolve(absDir)
    for (let index = this.layers.length - 1; index >= 0; index--) {
      if (this.layers[index].baseDir === resolved) {
        this.layers.splice(index, 1)
        return
      }
    }
  }

  /** Whether `absPath` should be excluded from the archive. */
  isIgnored(absPath: string, isDirectory: boolean): boolean {
    const resolved = resolve(absPath)
    let ignored = false

    for (const { baseDir, matcher } of this.layers) {
      const rel = relative(baseDir, resolved)
      if (rel === "" || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        continue
      }

      const candidates = isDirectory ? [`${rel}/`, rel] : [rel]
      for (const candidate of candidates) {
        const result = matcher.test(candidate)
        if (result.unignored) ignored = false
        else if (result.ignored) ignored = true
      }
    }

    return ignored
  }

  private pushLayer(absDir: string): void {
    const matcher = readGitignoreFile(absDir)
    if (!matcher) return
    this.layers.push({ baseDir: resolve(absDir), matcher })
  }
}
