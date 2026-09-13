/**
 * @module cli/commands/qr
 *
 * `text-compress qr` — render a payload's QR frames to numbered PNG files.
 * Supports `--dry-run` to preview the image count before writing anything.
 */

import { readTerminalSize, recommendChunkSize } from "../../qr/capacity.js"
import { countQrImages, writeQrImages } from "../../qr/images.js"
import { createTransfer } from "../../qr/protocol.js"
import { formatBytes, formatCount, printRunSummary } from "../analytics.js"
import type { Args } from "../args.js"
import { resolveOutputPath } from "../paths.js"
import { prepareQrPayload } from "../payload.js"

/** Execute `text-compress qr`. */
export async function runQrImages(args: Args): Promise<void> {
  const ec = args.ec ?? "M"
  const { payload, name, kind, note } = prepareQrPayload(args)
  const chunkSize = args.chunkSize ?? recommendChunkSize(readTerminalSize(), ec, name)
  const transfer = await createTransfer({ payload, name, kind, chunkSize })
  const { header } = transfer

  const baseStats = {
    File: name,
    Kind: kind,
    Payload: formatBytes(Buffer.byteLength(payload, "utf-8")),
    Chunks: formatCount(header.chunkCount),
    "Chunk size": `${header.chunkSize} chars`,
    ECC: ec,
    ...(note ? { Note: note } : {}),
  }

  if (args.dryRun) {
    printRunSummary({
      title: "QR images (dry run) — no files written",
      outputPaths: [],
      stats: {
        ...baseStats,
        Images: formatCount(countQrImages(transfer)),
      },
    })
    return
  }

  const outDir = resolveOutputPath(args, "qr-images", "-qr")
  const result = await writeQrImages(transfer, {
    ec,
    outDir,
    size: args.imageSize,
  })

  printRunSummary({
    title: `QR images → ${result.paths.length} files`,
    outputPaths: result.paths,
    stats: {
      ...baseStats,
      Images: formatCount(result.frameCount),
      "QR version": result.qrVersion,
    },
  })
}
