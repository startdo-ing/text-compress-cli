import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const cli = join(import.meta.dirname, "../dist/cli.js")
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tc-cli-"))
  tempDirs.push(dir)
  return dir
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], { encoding: "utf-8" })
}

describe("cli path auto-detection", () => {
  it("compresses a file from a bare path", () => {
    const dir = makeTempDir()
    const input = join(dir, "notes.md")
    const output = join(dir, "notes.txt")
    writeFileSync(input, "# hello")

    runCli(["compress", input, "-o", output])

    expect(readFileSync(output, "utf-8").length).toBeGreaterThan(0)
  })

  it("compresses a folder from a bare path", () => {
    const dir = makeTempDir()
    const project = join(dir, "project")
    mkdirSync(project)
    writeFileSync(join(project, "readme.txt"), "hello")
    const output = join(dir, "project.txt")

    runCli(["compress", project, "-o", output])

    expect(readFileSync(output, "utf-8").length).toBeGreaterThan(0)
  })

  it("excludes gitignored files when compressing a folder", () => {
    const dir = makeTempDir()
    const project = join(dir, "project")
    mkdirSync(project)
    writeFileSync(join(project, ".gitignore"), "*.log\n")
    writeFileSync(join(project, "readme.txt"), "hello")
    writeFileSync(join(project, "debug.log"), "drop")
    const output = join(dir, "project.txt")
    const restored = join(dir, "restored")

    runCli(["compress", project, "-o", output])
    runCli(["decompress", output, "-o", restored])

    expect(readFileSync(join(restored, "readme.txt"), "utf-8")).toBe("hello")
    expect(() => readFileSync(join(restored, "debug.log"), "utf-8")).toThrow()
  })

  it("decompresses from a bare path", () => {
    const dir = makeTempDir()
    const input = join(dir, "notes.md")
    const compressed = join(dir, "notes.txt")
    const restored = join(dir, "notes.de.txt")
    writeFileSync(input, "restore me")

    runCli(["compress", input, "-o", compressed])
    runCli(["decompress", compressed, "-o", restored])

    expect(readFileSync(restored, "utf-8")).toBe("restore me")
  })

  it("treats a missing compress path as inline text", () => {
    const dir = makeTempDir()
    const output = join(dir, "inline.txt")

    runCli(["compress", "inline payload", "-o", output])

    runCli(["decompress", output, "-o", join(dir, "inline.de.txt")])
    expect(readFileSync(join(dir, "inline.de.txt"), "utf-8")).toBe("inline payload")
  })

  it("auto-splits large compress output at 30,000 characters", () => {
    const dir = makeTempDir()
    const input = join(dir, "large.txt")
    const payload = Array.from({ length: 8_000 }, (_, i) => `line ${i} varied ${i * i}\n`).join("")
    writeFileSync(input, payload)

    runCli(["compress", input, "-o", join(dir, "large-out.txt")])

    expect(readFileSync(join(dir, "large-out.1.txt"), "utf-8").length).toBeLessThanOrEqual(30_000)
    expect(readFileSync(join(dir, "large-out.2.txt"), "utf-8").length).toBeGreaterThan(0)
    runCli(["decompress", join(dir, "large-out.1.txt"), "-o", join(dir, "large-restored.txt")])
    expect(readFileSync(join(dir, "large-restored.txt"), "utf-8")).toBe(payload)
  })
})
