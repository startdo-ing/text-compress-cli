/**
 * @module qr/capacity
 *
 * Pick a QR chunk size that fits the terminal and the chosen ECC level.
 *
 * Byte-mode capacities are from the QR Code spec. Terminal rendering uses
 * Unicode half-blocks (two modules per row), so vertical space is the usual
 * bottleneck.
 *
 * Chunk size is limited by the **largest** envelope (usually XOR parity),
 * not the data chunk alone, so every frame can share one QR version.
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

/** Smallest QR version whose byte-mode capacity is at least `bytes`. */
export function versionForByteCount(bytes: number, ec: ErrorCorrection): number {
  const table = BYTE_CAPACITY[ec]
  for (let version = 1; version <= table.length; version++) {
    if (table[version - 1] >= bytes) return version
  }
  throw new Error(`A ${bytes}-byte QR frame exceeds version ${table.length} at ECC ${ec}.`)
}

/**
 * QR version that fits every frame in `frames` (UTF-8 byte length).
 * All terminal paints should use this so the symbol size does not pulse.
 */
export function lockedQrVersion(frames: Iterable<string>, ec: ErrorCorrection): number {
  let max = 0
  const encoder = new TextEncoder()
  for (const frame of frames) {
    const n = encoder.encode(frame).length
    if (n > max) max = n
  }
  return versionForByteCount(max, ec)
}

/**
 * Largest QR version whose symbol (plus quiet zone) fits in the terminal
 * when drawn with half-blocks as a single code.
 */
export function versionForTerminal(size: TerminalSize, quietZone = 2): number {
  return versionForCell(size.columns - 2, (size.rows - 7) * 2, quietZone, 5)
}

/**
 * Largest QR version that fits one cell of a 2×2 terminal grid
 * (gap + status line reserved).
 */
export function versionForTerminalGrid(
  size: TerminalSize,
  cols = 2,
  rows = 2,
  quietZone = 2,
): number {
  const statusRows = 3
  const gapCols = 2
  const gapRows = 1
  const cellCols = Math.floor((size.columns - gapCols * (cols - 1)) / cols)
  const cellRows = Math.floor((size.rows - statusRows - gapRows * (rows - 1)) / rows)
  return versionForCell(cellCols, cellRows * 2, quietZone, 1)
}

function versionForCell(
  maxWidth: number,
  maxHeight: number,
  quietZone: number,
  minVersion: number,
): number {
  const maxModules = Math.min(Math.max(21, maxWidth), Math.max(21, maxHeight)) - quietZone * 2
  const version = Math.floor((maxModules - 21) / 4) + 1
  return Math.min(25, Math.max(minVersion, version))
}

/**
 * Upper bound on encoded TCQR frame size for a given data-chunk length.
 * Parity is Base64 of `chunkSize` uint16s, so it is the usual maximum
 * once the header (SHA-256 + name) already fits.
 */
export function estimatedMaxFrameBytes(chunkSize: number, name = "payload.txt"): number {
  const data = 28 + chunkSize
  const body = 4 * Math.ceil((chunkSize * 2) / 3)
  const parity = 26 + body
  return Math.max(data, parity, estimatedHeaderBytes(name))
}

function estimatedHeaderBytes(name: string): number {
  return [
    "TCQR1h",
    "ffffffff",
    "999999",
    "9999",
    "99999999",
    "a".repeat(64),
    "c",
    String(name.length),
    name,
  ].join("|").length
}

/**
 * Character budget for one data-frame payload, derived from terminal size.
 *
 * Sized so header, data, and parity frames all fit the same QR version.
 * The header’s SHA-256 may force a version larger than a tiny terminal
 * would pick for data alone — that version is still locked for every frame.
 */
export function recommendChunkSize(
  size: TerminalSize | undefined,
  ec: ErrorCorrection = "M",
  name = "payload.txt",
): number {
  const termVersion =
    !size || size.columns < 40 || size.rows < 16 ? 6 : versionForTerminalGrid(size)
  const headerVersion = versionForByteCount(estimatedHeaderBytes(name), ec)
  const version = Math.max(termVersion, headerVersion)
  return chunkSizeForCapacity(qrByteCapacity(version, ec), name)
}

export function readTerminalSize(): TerminalSize | undefined {
  const columns = process.stdout.columns
  const rows = process.stdout.rows
  if (!columns || !rows) return undefined
  return { columns, rows }
}

function chunkSizeForCapacity(cap: number, name: string): number {
  let lo = 1
  let hi = cap
  let best = 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (estimatedMaxFrameBytes(mid, name) <= cap) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}
