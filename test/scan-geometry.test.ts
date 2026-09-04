import { describe, expect, it } from "vitest"
import {
  chooseLock,
  containsBox,
  coverOrigin,
  GRID_SPAN,
  gridLock,
  type ScanBox,
  SINGLE_SPAN,
  splitQuadrants,
} from "../web-receiver/src/lib/scan-geometry.ts"

const FRAME = 1000

function qr(x: number, y: number, side = 80): ScanBox {
  return { x, y, w: side, h: side }
}

/** Top-left origin 2×2 of 80px QRs with a 10px gutter. */
function gridAt(x: number, y: number, side = 80, gap = 10): ScanBox[] {
  const step = side + gap
  return [
    qr(x, y, side),
    qr(x + step, y, side),
    qr(x, y + step, side),
    qr(x + step, y + step, side),
  ]
}

function requireBox(box: ScanBox | null): ScanBox {
  expect(box).not.toBeNull()
  if (box === null) throw new Error("expected a lock box")
  return box
}

describe("gridLock", () => {
  it("expands a single top-left QR so the other three tiles still fit", () => {
    const tiles = gridAt(120, 140)
    const lock = requireBox(gridLock([tiles[0]], FRAME, FRAME))
    for (const tile of tiles) {
      expect(containsBox(lock, tile, 4)).toBe(true)
    }
  })

  it("expands a single bottom-right QR to cover the grid", () => {
    const tiles = gridAt(120, 140)
    const lock = requireBox(gridLock([tiles[3]], FRAME, FRAME))
    for (const tile of tiles) {
      expect(containsBox(lock, tile, 4)).toBe(true)
    }
  })

  it("expands a top-row pair downward onto the bottom row", () => {
    const tiles = gridAt(200, 200)
    const lock = requireBox(gridLock([tiles[0], tiles[1]], FRAME, FRAME))
    for (const tile of tiles) {
      expect(containsBox(lock, tile, 4)).toBe(true)
    }
  })

  it("expands a left-column pair across to the right column", () => {
    const tiles = gridAt(200, 200)
    const lock = requireBox(gridLock([tiles[0], tiles[2]], FRAME, FRAME))
    for (const tile of tiles) {
      expect(containsBox(lock, tile, 4)).toBe(true)
    }
  })

  it("keeps a four-hit union on the grid instead of a single tile", () => {
    const tiles = gridAt(300, 280)
    const lock = requireBox(gridLock(tiles, FRAME, FRAME))
    const unionSide = 80 * GRID_SPAN
    expect(lock.w).toBeGreaterThan(unionSide * 0.9)
    expect(lock.h).toBeGreaterThan(unionSide * 0.9)
    for (const tile of tiles) {
      expect(containsBox(lock, tile, 2)).toBe(true)
    }
  })

  it("uses a locate hint when no symbols decoded", () => {
    const hint = { x: 200, y: 200, w: 220, h: 220 }
    const lock = requireBox(gridLock([], FRAME, FRAME, hint))
    expect(containsBox(lock, hint, 0)).toBe(true)
  })
})

describe("chooseLock", () => {
  it("does not replace a 2×2 lock with a later one-QR box", () => {
    const tiles = gridAt(150, 150)
    const grid = requireBox(gridLock(tiles, FRAME, FRAME))
    // Simulate a noisy frame that returns the un-expanded QR.
    const collapsed = tiles[0]
    const kept = requireBox(chooseLock(grid, collapsed, 1))
    expect(boxAreaRatio(kept, grid)).toBeGreaterThan(0.9)
    expect(kept.w).toBeGreaterThan(collapsed.w * SINGLE_SPAN * 0.5)
  })

  it("grows from a first lock when two or more codes appear", () => {
    const tiles = gridAt(150, 150)
    const one = tiles[0]
    const grid = requireBox(gridLock(tiles, FRAME, FRAME))
    const next = requireBox(chooseLock(one, grid, 4))
    expect(next.w).toBeGreaterThan(one.w * 1.5)
  })

  it("tightens an oversized one-code lock once four tiles are visible", () => {
    const tiles = gridAt(150, 150)
    const fromOne = requireBox(gridLock([tiles[0]], FRAME, FRAME))
    const fromFour = requireBox(gridLock(tiles, FRAME, FRAME))
    const next = chooseLock(fromOne, fromFour, 4)
    expect(next).toEqual(fromFour)
    expect(requireBox(next).w).toBeLessThan(fromOne.w)
  })

  it("takes the first lock when none exists yet", () => {
    const box = qr(10, 10)
    expect(chooseLock(null, box, 1)).toEqual(box)
  })

  it("keeps the previous object when the next box barely moved", () => {
    const prev = qr(100, 100, 200)
    const next = { x: 104, y: 98, w: 206, h: 197 }
    expect(chooseLock(prev, next, 4)).toBe(prev)
  })
})

describe("splitQuadrants", () => {
  it("returns four overlapping cells inside the parent", () => {
    const parent = { x: 100, y: 80, w: 200, h: 200 }
    const cells = splitQuadrants(parent, FRAME, FRAME)
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      expect(containsBox(parent, cell, 0)).toBe(true)
    }
  })
})

describe("coverOrigin", () => {
  it("zooms toward the grid center, not a single tile", () => {
    const tiles = gridAt(280, 280, 180)
    const lock = requireBox(gridLock(tiles, FRAME, FRAME))
    const view = coverOrigin(lock, FRAME, FRAME, 400, 400, true)
    const one = coverOrigin(tiles[0], FRAME, FRAME, 400, 400, true)
    expect(view.zoom).toBeGreaterThan(1)
    expect(view.zoom).toBeLessThan(one.zoom)
    expect(Math.abs(view.ox - 50)).toBeLessThan(Math.abs(one.ox - 50))
  })

  it("stays idle when the camera is off", () => {
    expect(coverOrigin(qr(0, 0), FRAME, FRAME, 400, 400, false)).toEqual({
      ox: 50,
      oy: 50,
      zoom: 1,
    })
  })
})

function boxAreaRatio(a: ScanBox, b: ScanBox): number {
  return (a.w * a.h) / (b.w * b.h)
}
