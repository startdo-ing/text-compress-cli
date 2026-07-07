import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { compressFolder, decompressToPath } from "../src/index.js"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "text-compress-gitignore-"))
  tempDirs.push(dir)
  return dir
}

describe("gitignore filtering", () => {
  it("excludes files matching the root .gitignore", () => {
    const src = makeTempDir()
    writeFileSync(join(src, ".gitignore"), "node_modules/\n*.log\n")
    writeFileSync(join(src, "keep.txt"), "keep")
    writeFileSync(join(src, "debug.log"), "drop")
    mkdirSync(join(src, "node_modules"))
    writeFileSync(join(src, "node_modules", "pkg.js"), "drop")

    const { encoded } = compressFolder(src, 64)
    const dest = makeTempDir()
    const stats = decompressToPath(encoded, dest, 64)

    expect(stats.files).toBe(2)
    expect(readFileSync(join(dest, "keep.txt"), "utf-8")).toBe("keep")
    expect(existsSync(join(dest, ".gitignore"))).toBe(true)
    expect(existsSync(join(dest, "debug.log"))).toBe(false)
    expect(existsSync(join(dest, "node_modules"))).toBe(false)
  })

  it("applies nested .gitignore rules from outside into inside", () => {
    const src = makeTempDir()
    writeFileSync(join(src, ".gitignore"), "build/\n")
    mkdirSync(join(src, "src"))
    writeFileSync(join(src, "src", ".gitignore"), "*.tmp\n!important.o\n")
    writeFileSync(join(src, "src", "main.ts"), "code")
    writeFileSync(join(src, "src", "scratch.tmp"), "drop")
    writeFileSync(join(src, "src", "important.o"), "keep")
    mkdirSync(join(src, "build"))
    writeFileSync(join(src, "build", "out.js"), "drop")

    const { encoded } = compressFolder(src, 64)
    const dest = makeTempDir()
    const stats = decompressToPath(encoded, dest, 64)

    expect(stats.files).toBe(4)
    expect(readFileSync(join(dest, "src", "main.ts"), "utf-8")).toBe("code")
    expect(readFileSync(join(dest, "src", "important.o"), "utf-8")).toBe("keep")
    expect(existsSync(join(dest, "src", "scratch.tmp"))).toBe(false)
    expect(existsSync(join(dest, "build"))).toBe(false)
  })

  it("applies parent repo .gitignore when compressing a subdirectory", () => {
    const repo = makeTempDir()
    mkdirSync(join(repo, ".git"))
    writeFileSync(join(repo, ".gitignore"), "dist/\n")
    mkdirSync(join(repo, "pkg"))
    writeFileSync(join(repo, "pkg", "index.ts"), "code")
    mkdirSync(join(repo, "dist"))
    writeFileSync(join(repo, "dist", "bundle.js"), "drop")

    const { encoded } = compressFolder(join(repo, "pkg"), 64)
    const dest = makeTempDir()
    const stats = decompressToPath(encoded, dest, 64)

    expect(stats.files).toBe(1)
    expect(readFileSync(join(dest, "index.ts"), "utf-8")).toBe("code")
  })

  it("prunes ignored directories without emitting them", () => {
    const src = makeTempDir()
    writeFileSync(join(src, ".gitignore"), "ignored/\n")
    writeFileSync(join(src, "visible.txt"), "yes")
    mkdirSync(join(src, "ignored"))
    writeFileSync(join(src, "ignored", "hidden.txt"), "no")

    const { encoded, dirCount } = compressFolder(src, 64)
    expect(dirCount).toBe(0)

    const dest = makeTempDir()
    decompressToPath(encoded, dest, 64)
    expect(existsSync(join(dest, "visible.txt"))).toBe(true)
    expect(existsSync(join(dest, "ignored"))).toBe(false)
  })
})
