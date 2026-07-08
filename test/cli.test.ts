import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseSplitBuffer } from "../src/index.js"

const cli = join(import.meta.dirname, "../dist/cli.js")
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "text-compress-cli-"))
  tempDirs.push(dir)
  return dir
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], { encoding: "utf-8" })
}

describe("text-compress cli", () => {
  it("compresses a file from a bare path", () => {
    const dir = makeTempDir()
    const input = join(dir, "notes.md")
    const output = join(dir, "notes.txt")
    writeFileSync(input, "# hello")

    runCli([input, "-o", output])

    expect(readFileSync(output, "utf-8").length).toBeGreaterThan(0)
  })

  it("decompresses a compressed file without a subcommand", () => {
    const dir = makeTempDir()
    const input = join(dir, "notes.md")
    const compressed = join(dir, "notes.txt")
    const restored = join(dir, "notes.de.txt")
    writeFileSync(input, "restore me")

    runCli([input, "-o", compressed])
    runCli([compressed, "-o", restored])

    expect(readFileSync(restored, "utf-8")).toBe("restore me")
  })

  it("compresses a folder from a bare path", () => {
    const dir = makeTempDir()
    const project = join(dir, "project")
    mkdirSync(project)
    writeFileSync(join(project, "readme.txt"), "hello")
    const output = join(dir, "project.txt")

    runCli([project, "-o", output])

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

    runCli([project, "-o", output])
    runCli([output, "-o", restored])

    expect(readFileSync(join(restored, "readme.txt"), "utf-8")).toBe("hello")
    expect(() => readFileSync(join(restored, "debug.log"), "utf-8")).toThrow()
  })

  it("treats a missing path as inline text on compress", () => {
    const dir = makeTempDir()
    const output = join(dir, "inline.txt")

    runCli(["inline payload", "-o", output])
    runCli([output, "-o", join(dir, "inline.de.txt")])

    expect(readFileSync(join(dir, "inline.de.txt"), "utf-8")).toBe("inline payload")
  })

  it("auto-splits large compress output at 30,000 characters", () => {
    const dir = makeTempDir()
    const input = join(dir, "large.txt")
    const payload = Array.from({ length: 8_000 }, (_, i) => `line ${i} varied ${i * i}\n`).join("")
    writeFileSync(input, payload)

    runCli([input, "-o", join(dir, "large-out.txt")])

    const part1 = parseSplitBuffer(readFileSync(join(dir, "large-out.1.txt")))
    expect(part1[0].payload.length).toBeLessThanOrEqual(30_000)
    expect(readFileSync(join(dir, "large-out.2.txt"), "utf-8").length).toBeGreaterThan(0)
    runCli([join(dir, "large-out.1.txt"), "-o", join(dir, "large-restored.txt")])
    expect(readFileSync(join(dir, "large-restored.txt"), "utf-8")).toBe(payload)
  })

  it("round-trips text with a password", () => {
    const dir = makeTempDir()
    const input = join(dir, "secret.md")
    const compressed = join(dir, "secret.txt")
    const restored = join(dir, "secret.de.txt")
    const password = "cli-password"
    writeFileSync(input, "protected content")

    runCli([input, "-o", compressed, "-p", password])
    runCli([compressed, "-o", restored, "-p", password])

    expect(readFileSync(restored, "utf-8")).toBe("protected content")
  })

  it("round-trips a folder with a password", () => {
    const dir = makeTempDir()
    const project = join(dir, "project")
    const output = join(dir, "project.txt")
    const restored = join(dir, "restored")
    const password = "folder-cli-password"
    mkdirSync(project)
    writeFileSync(join(project, "readme.txt"), "hello")

    runCli([project, "-o", output, "-p", password])
    runCli([output, "-o", restored, "-p", password])

    expect(readFileSync(join(restored, "readme.txt"), "utf-8")).toBe("hello")
  })

  it("rejects password-protected decompress without a password", () => {
    const dir = makeTempDir()
    const input = join(dir, "secret.md")
    const compressed = join(dir, "secret.txt")
    writeFileSync(input, "protected content")
    runCli([input, "-o", compressed, "-p", "secret"])

    expect(() => runCli([compressed, "-o", join(dir, "out.txt")])).toThrow(/password-protected/)
  })

  it("supports legacy compress/decompress subcommands", () => {
    const dir = makeTempDir()
    const input = join(dir, "legacy.md")
    const compressed = join(dir, "legacy.txt")
    const restored = join(dir, "legacy.de.txt")
    writeFileSync(input, "legacy path")

    runCli(["compress", input, "-o", compressed])
    runCli(["decompress", compressed, "-o", restored])

    expect(readFileSync(restored, "utf-8")).toBe("legacy path")
  })

  it("forces compress with --compress", () => {
    const dir = makeTempDir()
    const input = join(dir, "notes.md")
    const compressed = join(dir, "notes.txt")
    const double = join(dir, "double.txt")
    writeFileSync(input, "hello")

    runCli([input, "-o", compressed])
    runCli(["--compress", compressed, "-o", double])

    expect(readFileSync(double, "utf-8")).not.toBe(readFileSync(compressed, "utf-8"))
    expect(readFileSync(double, "utf-8").length).toBeGreaterThan(
      readFileSync(compressed, "utf-8").length,
    )
  })
})
