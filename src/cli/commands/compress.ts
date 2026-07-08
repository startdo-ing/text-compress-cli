/**
 * @module cli/commands/compress
 *
 * `text-compress` command — Brotli-compress input and write encoded output.
 */

import { compress } from "../../api/text.js"
import { assertDirectory } from "../../fs/paths.js"
import { compressFolderToPath } from "../../streaming/folder.js"
import { printAnalytics, splitAnalytics } from "../analytics.js"
import { type Args, readInput, resolveEncoding } from "../args.js"
import { writeCompressedOutput } from "../output.js"
import { resolveOutputPath } from "../paths.js"

/** Execute the compress subcommand. */
export async function runCompress(args: Args): Promise<void> {
  const encoding = resolveEncoding(args)

  if (args.dir) {
    assertDirectory(args.dir)
    const outputPath = resolveOutputPath(args, "compressed.txt", ".txt")
    const start = process.hrtime.bigint()
    const {
      fileCount,
      dirCount,
      originalBytes,
      archiveBytes,
      compressedBytes,
      outputPaths,
      splitChunkSize,
    } = await compressFolderToPath(args.dir, outputPath, encoding, args.split, args.password)
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
    const ratio = originalBytes === 0 ? 0 : compressedBytes / originalBytes

    console.log(
      outputPaths.length === 1
        ? `Compressed folder written to ${outputPaths[0]}`
        : `Compressed folder written to ${outputPaths.length} files:\n  ${outputPaths.join("\n  ")}`,
    )
    printAnalytics({
      Encoding: `base${encoding}`,
      Files: fileCount,
      Directories: dirCount,
      "Original size (bytes)": originalBytes,
      "Archive size before compression (bytes)": archiveBytes,
      [`Compressed size (bytes, base${encoding})`]: compressedBytes,
      ...splitAnalytics(splitChunkSize, outputPaths.length),
      "Size ratio (compressed/original)": ratio.toFixed(3),
      "Space saved": `${((1 - ratio) * 100).toFixed(1)}%`,
      "Time taken (ms)": elapsedMs.toFixed(3),
    })
    return
  }

  const outputPath = resolveOutputPath(args, "compressed.txt", ".txt")
  const input = readInput(args)
  const inputBytes = Buffer.byteLength(input, "utf-8")

  const start = process.hrtime.bigint()
  const result = compress(input, encoding, args.password)
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6

  const { paths: outputPaths, splitChunkSize } = writeCompressedOutput(
    result,
    outputPath,
    args.split,
  )
  const outputBytes = Buffer.byteLength(result, "utf-8")
  const ratio = inputBytes === 0 ? 0 : outputBytes / inputBytes

  console.log(
    outputPaths.length === 1
      ? `Compressed output written to ${outputPath}`
      : `Compressed output written to ${outputPaths.length} files:\n  ${outputPaths.join("\n  ")}`,
  )
  printAnalytics({
    Encoding: `base${encoding}`,
    "Original size (bytes)": inputBytes,
    [`Compressed size (bytes, base${encoding})`]: outputBytes,
    ...splitAnalytics(splitChunkSize, outputPaths.length),
    "Size ratio (compressed/original)": ratio.toFixed(3),
    "Space saved": `${((1 - ratio) * 100).toFixed(1)}%`,
    "Time taken (ms)": elapsedMs.toFixed(3),
  })
}
