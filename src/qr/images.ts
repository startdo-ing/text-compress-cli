/**
 * @module qr/images
 *
 * Render a {@link Transfer} as numbered PNG files — one lap of QR frames
 * written to disk instead of animated in a terminal. Useful for printing or
 * for sharing a handful of images instead of scanning a live loop.
 */

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import qrcode from "qrcode"
import { lockedQrVersion } from "./capacity.js"
import type { ErrorCorrection, Transfer } from "./protocol.js"
import { framesForLap } from "./protocol.js"

export interface QrImageOptions {
  ec: ErrorCorrection
  outDir: string
  /** Pixel width of each output PNG (qrcode's default scaling otherwise). */
  size?: number
}

export interface QrImageResult {
  paths: string[]
  frameCount: number
  qrVersion: number
}

/** QR frame texts for one lap — the set of images `writeQrImages` would produce. */
export function qrImageFrames(transfer: Transfer): string[] {
  return framesForLap(transfer, 0)
}

/** Number of PNG files {@link writeQrImages} would create, without writing anything. */
export function countQrImages(transfer: Transfer): number {
  return qrImageFrames(transfer).length
}

/** Render one lap of QR frames to numbered PNG files in `outDir`. */
export async function writeQrImages(
  transfer: Transfer,
  options: QrImageOptions,
): Promise<QrImageResult> {
  const frames = qrImageFrames(transfer)
  const qrVersion = lockedQrVersion(frames, options.ec)
  mkdirSync(options.outDir, { recursive: true })

  const width = Math.max(3, String(frames.length).length)
  const paths: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const path = join(options.outDir, `qr-${String(i + 1).padStart(width, "0")}.png`)
    await qrcode.toFile(path, frames[i], {
      errorCorrectionLevel: options.ec,
      version: qrVersion,
      ...(options.size ? { width: options.size } : {}),
    })
    paths.push(path)
  }

  return { paths, frameCount: frames.length, qrVersion }
}
