/**
 * @module qr/loop
 *
 * Play a {@link Transfer} as a looping QR carousel on stdout.
 */

import { lockedQrVersion } from "./capacity.js"
import type { ErrorCorrection, Transfer } from "./protocol.js"
import { framesForLap } from "./protocol.js"
import { renderQr } from "./render.js"

export interface LoopOptions {
  fps: number
  ec: ErrorCorrection
  /** When set, play this many laps then return. Otherwise loop until abort. */
  laps?: number
  stdout?: NodeJS.WriteStream
  stdin?: NodeJS.ReadStream
  statusLine: (info: {
    lap: number
    frame: number
    total: number
    paused: boolean
    fps: number
  }) => string
}

const ENTER_ALT = "\x1b[?1049h\x1b[?25l"
const LEAVE_ALT = "\x1b[?25h\x1b[?1049l"
const HOME = "\x1b[H"
const ERASE_ALL = "\x1b[2J"
const ERASE_DOWN = "\x1b[J"
const SYNC_START = "\x1b[?2026h"
const SYNC_END = "\x1b[?2026l"

/**
 * Display QR frames in the alternate screen buffer until aborted.
 *
 * Keys: `q` / Ctrl+C quit, space pause, `+`/`-` change speed.
 */
export async function playQrLoop(transfer: Transfer, options: LoopOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout
  const stdin = options.stdin ?? process.stdin
  let fps = clampFps(options.fps)
  let paused = false
  let aborted = false
  let lap = 0
  let frameIndex = 0
  let frames = framesForLap(transfer, lap)
  const qrVersion = lockedQrVersion(frames, options.ec)

  const paint = Boolean(stdout.isTTY)
  if (paint && stdin.isTTY && stdin.setRawMode) {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
  }

  const onData = (chunk: string | Buffer) => {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8")
    for (const ch of s) {
      if (ch === "\x03" || ch === "q" || ch === "Q") aborted = true
      else if (ch === " ") paused = !paused
      else if (ch === "+" || ch === "=") fps = clampFps(fps + 1)
      else if (ch === "-" || ch === "_") fps = clampFps(fps - 1)
    }
  }
  stdin.on("data", onData)

  const restore = () => {
    stdin.off("data", onData)
    if (paint && stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false)
      stdin.pause()
    }
    if (paint) stdout.write(LEAVE_ALT)
  }

  const onSignal = () => {
    aborted = true
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  if (paint) stdout.write(ENTER_ALT + ERASE_ALL + HOME)

  try {
    while (!aborted) {
      if (options.laps !== undefined && lap >= options.laps) break
      if (!paused) {
        const text = frames[frameIndex]
        const qr = renderQr(text, options.ec, qrVersion)
        const status = options.statusLine({
          lap,
          frame: frameIndex + 1,
          total: frames.length,
          paused,
          fps,
        })
        if (paint) {
          // Home + erase all: header/data frames have different QR versions, so
          // a HOME-only paint leaves the previous symbol's bottom rows behind.
          stdout.write(
            `${SYNC_START}${HOME}${ERASE_ALL}${HOME}${qr}\n\n${status}\n${ERASE_DOWN}${SYNC_END}`,
          )
        } else {
          stdout.write(`${qr}\n\n${status}\n`)
        }
        frameIndex += 1
        if (frameIndex >= frames.length) {
          frameIndex = 0
          lap += 1
          frames = framesForLap(transfer, lap)
        }
      }
      await sleep(Math.round(1000 / fps))
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    restore()
  }
}

function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return 8
  return Math.min(24, Math.max(1, Math.round(fps)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
