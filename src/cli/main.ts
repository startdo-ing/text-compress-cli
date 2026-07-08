/**
 * @module cli/main
 *
 * CLI entry logic — parses argv and auto-routes to compress or decompress.
 */

import { readSplitInput } from "../split/parts.js"
import { type Args, parseArgs, resolveEncodingOptional, resolveInputArgs } from "./args.js"
import { runCompress } from "./commands/compress.js"
import { runDecompress } from "./commands/decompress.js"
import { detectCompressedPayload } from "./detect.js"
import { printUsage } from "./usage.js"

function wantsHelp(argv: string[]): boolean {
  return argv.length === 0 || argv.includes("-h") || argv.includes("--help")
}

/** Strip an optional legacy leading compress/decompress command. */
function normalizeArgv(argv: string[]): { argv: string[]; forcedMode?: Args["mode"] } {
  const [first, ...rest] = argv
  if (first === "compress" || first === "c") return { argv: rest, forcedMode: "compress" }
  if (first === "decompress" || first === "d") return { argv: rest, forcedMode: "decompress" }
  return { argv }
}

function readEncodedInput(args: Args): string {
  if (args.file) return readSplitInput(args.file).content
  if (args.text !== undefined) return args.text
  throw new Error("No input provided. Pass a path, or use -t <text>.")
}

function resolveCliMode(args: Args): "compress" | "decompress" {
  if (args.mode === "compress") return "compress"
  if (args.mode === "decompress") return "decompress"
  if (args.dir) return "compress"

  const encoded = readEncodedInput(args)
  const detection = detectCompressedPayload(encoded, resolveEncodingOptional(args), args.password)
  if (detection === "password-required") {
    throw new Error("This payload is password-protected. Pass -p/--password to decompress.")
  }
  if (detection === "compressed") return "decompress"
  return "compress"
}

/** Main CLI dispatcher. */
export function main() {
  let argv = process.argv.slice(2)

  if (wantsHelp(argv)) {
    printUsage()
    process.exit(argv.length === 0 ? 1 : 0)
  }

  const legacy = normalizeArgv(argv)
  argv = legacy.argv
  const args = parseArgs(argv)
  if (legacy.forcedMode && !args.mode) {
    args.mode = legacy.forcedMode
  }

  const run = async () => {
    resolveInputArgs(args, args.mode === "decompress" ? "decompress" : "compress")

    const mode = resolveCliMode(args)

    if (mode === "decompress") {
      runDecompress(args)
      return
    }

    await runCompress(args)
  }

  run().catch((err) => {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  })
}
