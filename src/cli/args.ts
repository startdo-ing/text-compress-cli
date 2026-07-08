/**
 * @module cli/args
 *
 * Command-line argument parsing and input resolution.
 *
 * The CLI accepts a positional path or explicit flags (`-t`, `-f`, `-d`).
 * `resolveInputArgs` normalises these into a single internal representation
 * and auto-detects files vs directories when a bare path is given.
 */

import { existsSync, statSync } from "node:fs"
import { assertDirectory, readTextFile } from "../fs/paths.js"
import type { Encoding } from "../types.js"

/** Parsed CLI flags (before input resolution). */
export interface Args {
  text?: string
  path?: string
  file?: string
  dir?: string
  output?: string
  encoding?: string
  split?: number
  password?: string
  /** Force compress or decompress instead of auto-detecting from input. */
  mode?: "compress" | "decompress"
}

/** Reject multiple simultaneous input sources. */
function assertSingleInput(args: Args) {
  const sources = [args.text, args.path, args.file, args.dir].filter((value) => value !== undefined)
  if (sources.length > 1) {
    throw new Error("Multiple inputs specified. Pass one path, or use -t, -f, or -d.")
  }
}

/**
 * Parse `process.argv` tail into an {@link Args} object.
 *
 * Uses a simple sequential scan (not a general-purpose parser library)
 * because the flag set is small and fixed.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "-t" || arg === "--text") {
      args.text = argv[++i]
    } else if (arg === "-f" || arg === "--file") {
      args.file = argv[++i]
    } else if (arg === "-d" || arg === "--dir") {
      args.dir = argv[++i]
    } else if (arg === "-o" || arg === "--output") {
      args.output = argv[++i]
    } else if (arg === "-e" || arg === "--encoding") {
      args.encoding = argv[++i]
    } else if (arg === "-s" || arg === "--split") {
      const value = argv[++i]
      const split = Number(value)
      if (!value || !Number.isInteger(split) || split < 1) {
        throw new Error(`Invalid -s/--split "${value}". Use a positive integer character count.`)
      }
      args.split = split
    } else if (arg === "-p" || arg === "--password") {
      const value = argv[++i]
      if (!value) {
        throw new Error("Missing value for -p/--password.")
      }
      args.password = value
    } else if (arg === "-C" || arg === "--compress") {
      args.mode = "compress"
    } else if (arg === "-D" || arg === "--decompress") {
      args.mode = "decompress"
    } else if (!arg.startsWith("-")) {
      if (args.path !== undefined || args.text !== undefined || args.file || args.dir) {
        throw new Error("Multiple inputs specified. Pass one path, or use -t, -f, or -d.")
      }
      args.path = arg
    }
  }
  return args
}

/**
 * Normalise and validate input paths after parsing.
 *
 * Mutates `args` in place: e.g. a directory passed as `-f` becomes `args.dir`.
 */
export function resolveInputArgs(args: Args, command: "compress" | "decompress"): void {
  assertSingleInput(args)
  if (args.text !== undefined) return

  const path = args.file ?? args.dir ?? args.path
  if (!path) {
    throw new Error("No input provided. Pass a path, or use -t <text>.")
  }

  if (args.dir) {
    assertDirectory(args.dir)
    return
  }

  if (args.file) {
    if (existsSync(args.file)) {
      const stat = statSync(args.file)
      if (stat.isDirectory()) {
        if (command === "decompress") {
          throw new Error(
            `"${args.file}" is a directory. Pass the compressed .txt file, not a decompressed output folder.`,
          )
        }
        args.dir = args.file
        args.file = undefined
      }
    }
    return
  }

  if (!existsSync(path)) {
    if (command === "compress") {
      args.text = path
      args.path = undefined
      return
    }
    throw new Error(`Input not found: ${path}`)
  }

  const stat = statSync(path)
  if (stat.isDirectory()) {
    if (command === "decompress") {
      throw new Error(
        `"${path}" is a directory. Pass the compressed .txt file, not a decompressed output folder.`,
      )
    }
    args.dir = path
    args.path = undefined
    return
  }

  if (stat.isFile()) {
    args.file = path
    args.path = undefined
    return
  }

  throw new Error(`Cannot read "${path}": not a regular file or directory.`)
}

/** Read compress input from resolved args (file or inline text). */
export function readInput(args: Args): string {
  if (args.file) return readTextFile(args.file, "compress")
  if (args.text !== undefined) return args.text
  throw new Error("No input provided. Pass a path, or use -t <text>.")
}

/** Parse `-e` encoding flag into the library's {@link Encoding} type. */
export function resolveEncoding(args: Args): Encoding {
  if (!args.encoding) return 64
  if (args.encoding === "64") return 64
  if (args.encoding === "85") return 85
  throw new Error(`Invalid -e/--encoding "${args.encoding}". Use 64 or 85.`)
}

/** Parse `-e` when set, otherwise `undefined` for auto-detection. */
export function resolveEncodingOptional(args: Args): Encoding | undefined {
  if (!args.encoding) return undefined
  return resolveEncoding(args)
}
