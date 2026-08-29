/**
 * @module cli/commands/send
 *
 * Stream a payload as looping QR codes for a camera receiver.
 */

import { basename, extname } from "node:path"
import { compressFolder } from "../../api/folder.js"
import { compress } from "../../api/text.js"
import { readTerminalSize, recommendChunkSize } from "../../qr/capacity.js"
import { playQrLoop } from "../../qr/loop.js"
import { createTransfer, framesForLap, type PayloadKind } from "../../qr/protocol.js"
import { readSplitInput } from "../../split/parts.js"
import { formatBytes, formatCount, printRunSummary } from "../analytics.js"
import { type Args, readInput, resolveEncoding, resolveEncodingOptional } from "../args.js"
import { detectCompressedPayload } from "../detect.js"

const DEFAULT_FPS = 8

/** Execute `text-compress send` / `--send`. */
export async function runSend(args: Args): Promise<void> {
  const fps = args.fps ?? DEFAULT_FPS
  const ec = args.ec ?? "M"
  const { payload, name, kind, note } = preparePayload(args)
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
    "\nOpen web-receiver, allow the camera, and point it at this QR. q or Ctrl+C stops.\nSpace pauses. + / - changes speed.\n\n",
  )

  await playQrLoop(transfer, {
    fps,
    ec,
    statusLine: ({ lap, frame, total, paused, fps: currentFps }) =>
      [
        `${name}  ${frame}/${total}  lap ${lap + 1}  ${currentFps} fps${paused ? "  paused" : ""}`,
        `session ${header.sessionId}  ${header.chunkCount} chunks  q quit  space pause  +/- speed`,
      ].join("\n"),
  })
}

function preparePayload(args: Args): {
  payload: string
  name: string
  kind: PayloadKind
  note?: string
} {
  const encoding = resolveEncoding(args)

  if (args.raw) {
    if (args.dir) {
      throw new Error("--raw cannot send a folder. Omit --raw so the folder is compressed first.")
    }
    const payload = args.file ? readSplitInput(args.file).content : readInput(args)
    return {
      payload,
      name: args.file ? basename(args.file) : "paste.txt",
      kind: "raw",
    }
  }

  if (args.dir) {
    const { encoded } = compressFolder(args.dir, encoding, args.password)
    return {
      payload: encoded,
      name: `${basename(args.dir)}.txt`,
      kind: "compressed",
    }
  }

  if (args.file) {
    const { content, partPaths } = readSplitInput(args.file)
    const detection = detectCompressedPayload(content, resolveEncodingOptional(args), args.password)
    if (detection === "compressed" || detection === "password-required") {
      return {
        payload: content.trim(),
        name: basename(args.file),
        kind: "compressed",
        note:
          detection === "password-required"
            ? "Sending locked payload as-is (unlock after receive)"
            : partPaths.length > 1
              ? `Joined ${partPaths.length} split parts`
              : undefined,
      }
    }
    const encoded = compress(content, encoding, args.password)
    const base = basename(args.file, extname(args.file))
    return { payload: encoded, name: `${base}.txt`, kind: "compressed" }
  }

  const encoded = compress(readInput(args), encoding, args.password)
  return { payload: encoded, name: "paste.txt", kind: "compressed" }
}
