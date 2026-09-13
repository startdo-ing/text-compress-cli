/**
 * @module cli/commands/send
 *
 * Stream a payload as looping QR codes for a camera receiver.
 */

import { readTerminalSize, recommendChunkSize } from "../../qr/capacity.js"
import { playQrLoop } from "../../qr/loop.js"
import { createTransfer, framesForLap } from "../../qr/protocol.js"
import { formatBytes, formatCount, printRunSummary } from "../analytics.js"
import type { Args } from "../args.js"
import { prepareQrPayload } from "../payload.js"

const DEFAULT_FPS = 8

/** Execute `text-compress send` / `--send`. */
export async function runSend(args: Args): Promise<void> {
  const fps = args.fps ?? DEFAULT_FPS
  const ec = args.ec ?? "M"
  const { payload, name, kind, note } = prepareQrPayload(args)
  const chunkSize = args.chunkSize ?? recommendChunkSize(readTerminalSize(), ec, name)
  const transfer = await createTransfer({ payload, name, kind, chunkSize })
  const { header } = transfer
  const firstLap = framesForLap(transfer, 0)

  printRunSummary({
    title: args.dump ? "QR frames (dump)" : "QR send — point the web-receiver camera here",
    outputPaths: [],
    stats: {
      File: name,
      Kind: kind,
      Payload: formatBytes(Buffer.byteLength(payload, "utf-8")),
      Chunks: formatCount(header.chunkCount),
      "Chunk size": `${header.chunkSize} chars`,
      "Frames / lap": formatCount(firstLap.length),
      Layout: "2×2 (4 QR)",
      Session: header.sessionId,
      "SHA-256": `${header.sha256.slice(0, 16)}…`,
      ECC: ec,
      FPS: fps,
      ...(note ? { Note: note } : {}),
    },
  })

  if (args.dump) {
    process.stdout.write(`${firstLap.join("\n")}\n`)
    return
  }

  if (!process.stdout.isTTY) {
    throw new Error("Refusing to animate QR codes on a non-terminal. Pass --dump to print frames.")
  }

  process.stderr.write(
    "\nOpen web-receiver, allow the camera, and point it at the 2×2 QR grid. q or Ctrl+C stops.\nSpace pauses. + / - changes speed.\n\n",
  )

  await playQrLoop(transfer, {
    fps,
    ec,
    statusLine: ({ lap, frame, shown, total, paused, fps: currentFps }) => {
      const last = Math.min(frame + shown - 1, total)
      return [
        `${name}  ${frame}–${last}/${total}  4-up  lap ${lap + 1}  ${currentFps} fps${paused ? "  paused" : ""}`,
        `session ${header.sessionId}  ${header.chunkCount} chunks  q quit  space pause  +/- speed`,
      ].join("\n")
    },
  })
}
