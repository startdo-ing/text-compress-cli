/**
 * @module qr/capacity
 *
 * Pick a QR chunk size that fits the terminal and the chosen ECC level.
 *
 * Byte-mode capacities are from the QR Code spec. Terminal rendering uses
 * Unicode half-blocks (two modules per row), so vertical space is the usual
 * bottleneck.
 */

import type { ErrorCorrection } from "./protocol.js"

/** Byte-mode payload capacity for QR versions 1–25. */
const BYTE_CAPACITY: Record<ErrorCorrection, number[]> = {
  L: [
    17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
    929, 1003, 1091, 1171, 1273,
  ],
  M: [
    14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
    711, 779, 857, 911, 997,
  ],
  Q: [
    11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482,
    509, 565, 611, 661, 715,
  ],
  H: [
    7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403,
    439, 461, 511, 535,
  ],
}

/** Typical `TCQR1d|<sid>|<i>|<len>|` prefix length. */
const FRAME_OVERHEAD = 32

export interface TerminalSize {
  columns: number
  rows: number
}

/** Modules on one side of a QR symbol for a given version. */
export function qrModules(version: number): number {
  return 21 + (version - 1) * 4
}

export function qrByteCapacity(version: number, ec: ErrorCorrection): number {
  const table = BYTE_CAPACITY[ec]
  const index = version - 1
  if (index < 0 || index >= table.length) {
    throw new Error(`QR version ${version} is out of range (1–${table.length}).`)
  }
  return table[index]
}

/**
 * Largest QR version whose symbol (plus quiet zone) fits in the terminal
 * when drawn with half-blocks.
 */
export function versionForTerminal(size: TerminalSize, quietZone = 2): number {
  const maxWidth = Math.max(21, size.columns - 2)
  const maxHeight = Math.max(21, (size.rows - 7) * 2)
  const maxModules = Math.min(maxWidth, maxHeight) - quietZone * 2
  const version = Math.floor((maxModules - 21) / 4) + 1
  return Math.min(25, Math.max(5, version))
}

/**
 * Character budget for one data-frame payload, derived from terminal size.
 * Falls back to 180 when the terminal is tiny or size is unknown.
 */
export function recommendChunkSize(
  size: TerminalSize | undefined,
  ec: ErrorCorrection = "M",
): number {
  if (!size || size.columns < 40 || size.rows < 16) {
    return Math.max(40, qrByteCapacity(10, ec) - FRAME_OVERHEAD)
  }
  const version = versionForTerminal(size)
  return Math.max(40, qrByteCapacity(version, ec) - FRAME_OVERHEAD)
}

export function readTerminalSize(): TerminalSize | undefined {
  const columns = process.stdout.columns
  const rows = process.stdout.rows
  if (!columns || !rows) return undefined
  return { columns, rows }
}
