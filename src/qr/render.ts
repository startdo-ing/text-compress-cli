/**
 * @module qr/render
 *
 * Render a QR matrix as Unicode half-blocks on a white ANSI background.
 * Black-on-white is much more reliable for phone cameras than the inverse.
 */

import qrcode from "qrcode"
import { qrModules } from "./capacity.js"
import type { ErrorCorrection } from "./protocol.js"

const RESET = "\x1b[0m"
const PAPER = "\x1b[48;5;231m\x1b[38;5;16m"
const ERASE_LINE = "\x1b[K"

/** How many QR symbols the sender paints per tick (2×2). */
export const QR_TILE_COLS = 2
export const QR_TILE_ROWS = 2
export const QR_TILES = QR_TILE_COLS * QR_TILE_ROWS

/**
 * Draw `text` as a QR for a terminal.
 * Pass `version` so every frame occupies the same module grid.
 */
export function renderQr(text: string, ec: ErrorCorrection = "M", version?: number): string {
  return qrLines(text, ec, version, true).join("\n")
}

/**
 * Draw up to {@link QR_TILES} payloads as a 2×2 grid of equal-sized QRs.
 * Missing slots wrap from the start of `texts`.
 */
export function renderQrGrid(texts: string[], ec: ErrorCorrection = "M", version?: number): string {
  if (texts.length === 0) return ""
  const tiles = Array.from({ length: QR_TILES }, (_, i) =>
    qrLines(texts[i % texts.length], ec, version, false),
  )
  const gap = "  "
  const top = joinTileRow(tiles[0], tiles[1], gap)
  const bottom = joinTileRow(tiles[2], tiles[3], gap)
  const spacer = `${ERASE_LINE}`
  return [...top, spacer, ...bottom].join("\n")
}

function qrLines(
  text: string,
  ec: ErrorCorrection,
  version: number | undefined,
  erase: boolean,
): string[] {
  const qr = qrcode.create(text, {
    errorCorrectionLevel: ec,
    ...(version !== undefined ? { version } : {}),
  })
  const modules = version !== undefined ? qrModules(version) : qr.modules.size
  const quiet = 2
  const dim = modules + quiet * 2
  const origin = quiet + Math.floor((modules - qr.modules.size) / 2)
  const lines: string[] = []

  const dark = (x: number, y: number): boolean => {
    const mx = x - origin
    const my = y - origin
    if (mx < 0 || my < 0 || mx >= qr.modules.size || my >= qr.modules.size) return false
    return qr.modules.get(my, mx) === 1
  }

  for (let y = 0; y < dim; y += 2) {
    let line = PAPER
    for (let x = 0; x < dim; x++) {
      const top = dark(x, y)
      const bot = y + 1 < dim ? dark(x, y + 1) : false
      line += top && bot ? "█" : top ? "▀" : bot ? "▄" : " "
    }
    line += `${RESET}${erase ? ERASE_LINE : ""}`
    lines.push(line)
  }

  return lines
}

function joinTileRow(left: string[], right: string[], gap: string): string[] {
  const rows = Math.max(left.length, right.length)
  const out: string[] = []
  for (let i = 0; i < rows; i++) {
    out.push(`${left[i] ?? ""}${gap}${right[i] ?? ""}${ERASE_LINE}`)
  }
  return out
}
