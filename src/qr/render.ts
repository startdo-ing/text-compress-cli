/**
 * @module qr/render
 *
 * Render a QR matrix as Unicode half-blocks on a white ANSI background.
 * Black-on-white is much more reliable for phone cameras than the inverse.
 */

import qrcode from "qrcode"
import type { ErrorCorrection } from "./protocol.js"

const RESET = "\x1b[0m"
const PAPER = "\x1b[48;5;231m\x1b[38;5;16m"

/** Draw `text` as a compact QR for a terminal. */
export function renderQr(text: string, ec: ErrorCorrection = "M"): string {
  const qr = qrcode.create(text, { errorCorrectionLevel: ec })
  const size = qr.modules.size
  const quiet = 2
  const dim = size + quiet * 2
  const lines: string[] = []

  const dark = (x: number, y: number): boolean => {
    if (x < quiet || y < quiet || x >= size + quiet || y >= size + quiet) return false
    return qr.modules.get(y - quiet, x - quiet) === 1
  }

  for (let y = 0; y < dim; y += 2) {
    let line = PAPER
    for (let x = 0; x < dim; x++) {
      const top = dark(x, y)
      const bot = y + 1 < dim ? dark(x, y + 1) : false
      line += top && bot ? "█" : top ? "▀" : bot ? "▄" : " "
    }
    line += RESET
    lines.push(line)
  }

  return lines.join("\n")
}
