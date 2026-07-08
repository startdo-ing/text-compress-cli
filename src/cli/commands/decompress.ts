/**
 * @module cli/commands/decompress
 *
 * `tc decompress` command — decode and restore text or folder payloads.
 */

import { writeFileSync } from "node:fs"
import { unpackDirectory } from "../../archive/unpack.js"
import { decompressPayload, TAG_FOLDER, TAG_TEXT } from "../../payload/tags.js"
import { readSplitInput } from "../../split/parts.js"
import { printAnalytics } from "../analytics.js"
import { type Args, readInput, resolveEncoding } from "../args.js"
import { resolveOutputPath } from "../paths.js"

/** Read compressed input from file (with split support) or inline text. */
function readCompressedInput(args: Args): {
  content: string
  inputBytes: number
  partPaths?: string[]
} {
  if (args.file) {
    const { content, partPaths } = readSplitInput(args.file)
    return {
      content,
      inputBytes: Buffer.byteLength(content, "utf-8"),
      partPaths: partPaths.length > 1 ? partPaths : undefined,
    }
  }

  const content = readInput(args)
  return { content, inputBytes: Buffer.byteLength(content, "utf-8") }
}

/** Execute the decompress subcommand. */
export function runDecompress(args: Args): void {
  const encoding = resolveEncoding(args)
  const { content: input, inputBytes, partPaths } = readCompressedInput(args)

  const start = process.hrtime.bigint()
  const { tag, data } = decompressPayload(input.trim(), encoding, args.password)
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6

  if (tag === TAG_FOLDER) {
    const outputPath = resolveOutputPath(args, "decompressed.de", ".de")
    const { files, dirs, bytes } = unpackDirectory(data, outputPath)

    console.log(`Decompressed folder recreated at ${outputPath}`)
    printAnalytics({
      Encoding: `base${encoding}`,
      [`Compressed size (bytes, base${encoding})`]: inputBytes,
      ...(partPaths ? { "Input parts": partPaths.length } : {}),
      "Files restored": files,
      "Directories restored": dirs,
      "Decompressed size (bytes)": bytes,
      "Time taken (ms)": elapsedMs.toFixed(3),
    })
    return
  }

  if (tag !== TAG_TEXT) {
    throw new Error(`Corrupt or unrecognized payload (tag 0x${tag.toString(16)}).`)
  }

  const outputPath = resolveOutputPath(args, "decompressed.de.txt", ".de.txt")
  const result = data.toString("utf-8")
  writeFileSync(outputPath, result, "utf-8")
  const outputBytes = Buffer.byteLength(result, "utf-8")
  const ratio = inputBytes === 0 ? 0 : outputBytes / inputBytes

  console.log(`Decompressed output written to ${outputPath}`)
  printAnalytics({
    Encoding: `base${encoding}`,
    [`Compressed size (bytes, base${encoding})`]: inputBytes,
    ...(partPaths ? { "Input parts": partPaths.length } : {}),
    "Decompressed size (bytes)": outputBytes,
    "Expansion ratio (decompressed/compressed)": ratio.toFixed(3),
    "Time taken (ms)": elapsedMs.toFixed(3),
  })
}
