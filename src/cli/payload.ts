/**
 * @module cli/payload
 *
 * Shared payload resolution for QR-based commands (`send`, `qr`).
 */

import { basename, extname } from "node:path"
import { compressFile } from "../api/file.js"
import { compressFolder } from "../api/folder.js"
import { compress } from "../api/text.js"
import type { PayloadKind } from "../qr/protocol.js"
import { readSplitInput } from "../split/parts.js"
import {
  type Args,
  readInput,
  readInputBuffer,
  resolveEncoding,
  resolveEncodingOptional,
} from "./args.js"
import { detectCompressedPayload } from "./detect.js"

export interface PreparedQrPayload {
  payload: string
  name: string
  kind: PayloadKind
  note?: string
}

/** Resolve the payload, filename, and kind for a QR-based command. */
export function prepareQrPayload(args: Args): PreparedQrPayload {
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
    const encoded = compressFile(readInputBuffer(args), encoding, args.password)
    const base = basename(args.file, extname(args.file))
    return { payload: encoded, name: `${base}.txt`, kind: "compressed" }
  }

  const encoded = compress(readInput(args), encoding, args.password)
  return { payload: encoded, name: "paste.txt", kind: "compressed" }
}
