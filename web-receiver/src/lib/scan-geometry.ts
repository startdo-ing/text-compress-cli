/**
 * Geometry for locking the camera onto the sender's 2×2 QR grid.
 * A single detected symbol is expanded so its three siblings stay in the crop.
 */

export type ScanBox = { x: number; y: number; w: number; h: number }

/** Two tiles plus the terminal gap, relative to one QR side. */
export const GRID_SPAN = 2.32

/**
 * Centered box around one corner tile that still covers the far sibling.
 * 2 * GRID_SPAN - 0.85 ≈ 3.79.
 */
export const SINGLE_SPAN = 2 * GRID_SPAN - 0.85

export function boxArea(box: ScanBox): number {
  return Math.max(0, box.w) * Math.max(0, box.h)
}

export function clampBox(box: ScanBox, width: number, height: number): ScanBox {
  const x = clamp(box.x, 0, Math.max(0, width - 1))
  const y = clamp(box.y, 0, Math.max(0, height - 1))
  return {
    x,
    y,
    w: Math.max(1, Math.min(box.w, width - x)),
    h: Math.max(1, Math.min(box.h, height - y)),
  }
}

export function padBox(box: ScanBox, width: number, height: number, padFrac: number): ScanBox {
  const pad = Math.round(Math.max(box.w, box.h) * padFrac)
  return clampBox(
    {
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + pad * 2,
      h: box.h + pad * 2,
    },
    width,
    height,
  )
}

export function centerBox(width: number, height: number, frac: number): ScanBox {
  const side = Math.max(32, Math.round(Math.min(width, height) * frac))
  return clampBox(
    {
      x: (width - side) / 2,
      y: (height - side) / 2,
      w: side,
      h: side,
    },
    width,
    height,
  )
}

export function scaleBox(box: ScanBox, scaleX: number, scaleY: number): ScanBox {
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    w: box.w * scaleX,
    h: box.h * scaleY,
  }
}

export function unionBoxes(boxes: ScanBox[]): ScanBox {
  let x1 = Number.POSITIVE_INFINITY
  let y1 = Number.POSITIVE_INFINITY
  let x2 = 0
  let y2 = 0
  for (const box of boxes) {
    x1 = Math.min(x1, box.x)
    y1 = Math.min(y1, box.y)
    x2 = Math.max(x2, box.x + box.w)
    y2 = Math.max(y2, box.y + box.h)
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
}

export function boxesOverlap(a: ScanBox, b: ScanBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function containsBox(outer: ScanBox, inner: ScanBox, slack = 2): boolean {
  return (
    inner.x + slack >= outer.x &&
    inner.y + slack >= outer.y &&
    inner.x + inner.w - slack <= outer.x + outer.w &&
    inner.y + inner.h - slack <= outer.y + outer.h
  )
}

/**
 * Grow `box` to at least `minW`×`minH`, keeping its center, then clamp to the frame.
 * Clamping against an edge shifts the box inward — the usual case when a corner QR
 * sits near the frame border.
 */
export function growBox(
  box: ScanBox,
  minW: number,
  minH: number,
  width: number,
  height: number,
): ScanBox {
  const w = Math.max(box.w, minW)
  const h = Math.max(box.h, minH)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return clampBox({ x: cx - w / 2, y: cy - h / 2, w, h }, width, height)
}

export function typicalSide(boxes: ScanBox[]): number {
  if (boxes.length === 0) return 0
  const sides = boxes.map((box) => Math.max(box.w, box.h)).sort((a, b) => a - b)
  return sides[Math.floor(sides.length / 2)]
}

/**
 * Infer a lock that covers the whole 2×2 grid from however many symbols we saw.
 */
export function gridLock(
  boxes: ScanBox[],
  width: number,
  height: number,
  hint?: ScanBox | null,
): ScanBox | null {
  if (boxes.length === 0) {
    return hint ? padBox(hint, width, height, 0.08) : null
  }

  const union = unionBoxes(boxes)
  const side = Math.max(24, typicalSide(boxes))
  let grown: ScanBox

  if (boxes.length >= 4) {
    grown = growBox(union, side * GRID_SPAN, side * GRID_SPAN, width, height)
  } else if (boxes.length >= 2) {
    const aspect = union.w / union.h
    if (aspect > 1.35) {
      grown = growBox(union, Math.max(union.w, side * GRID_SPAN), side * SINGLE_SPAN, width, height)
    } else if (aspect < 0.74) {
      grown = growBox(union, side * SINGLE_SPAN, Math.max(union.h, side * GRID_SPAN), width, height)
    } else {
      grown = growBox(union, side * GRID_SPAN, side * GRID_SPAN, width, height)
    }
  } else {
    grown = growBox(union, side * SINGLE_SPAN, side * SINGLE_SPAN, width, height)
  }

  if (hint && boxesOverlap(hint, grown)) {
    const combined = unionBoxes([grown, hint])
    if (boxArea(combined) < width * height * 0.92) {
      grown = combined
    }
  }

  return padBox(grown, width, height, boxes.length >= 3 ? 0.08 : 0.12)
}

export function similarBox(a: ScanBox, b: ScanBox, slop = 12): boolean {
  return (
    Math.abs(a.x - b.x) <= slop &&
    Math.abs(a.y - b.y) <= slop &&
    Math.abs(a.w - b.w) <= slop &&
    Math.abs(a.h - b.h) <= slop
  )
}

/**
 * Prefer a lock that still covers the 2×2. Never collapse a wide lock back to one QR.
 */
export function chooseLock(
  prev: ScanBox | null,
  next: ScanBox | null,
  hitCount: number,
): ScanBox | null {
  if (!next) return prev
  if (!prev) return next
  if (similarBox(prev, next)) return prev

  const prevA = boxArea(prev)
  const nextA = boxArea(next)
  if (hitCount >= 3) return next
  if (hitCount <= 1) {
    return nextA > prevA * 1.08 ? next : prev
  }

  if (nextA >= prevA * 0.72) return next
  if (boxesOverlap(prev, next)) return unionBoxes([prev, next])
  return prev
}

export function splitQuadrants(box: ScanBox, width: number, height: number): ScanBox[] {
  const overlap = Math.round(Math.min(box.w, box.h) * 0.1)
  const midX = box.x + box.w / 2
  const midY = box.y + box.h / 2
  const cells = [
    { x: box.x, y: box.y, w: midX - box.x + overlap, h: midY - box.y + overlap },
    { x: midX - overlap, y: box.y, w: box.x + box.w - midX + overlap, h: midY - box.y + overlap },
    { x: box.x, y: midY - overlap, w: midX - box.x + overlap, h: box.y + box.h - midY + overlap },
    {
      x: midX - overlap,
      y: midY - overlap,
      w: box.x + box.w - midX + overlap,
      h: box.y + box.h - midY + overlap,
    },
  ]
  return cells.map((cell) => clampBox(cell, width, height))
}

/** Map a box from a resized/cropped bitmap back into camera pixels. */
export function mapBoxToVideo(
  box: ScanBox,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number,
): ScanBox {
  return {
    x: originX + box.x / scaleX,
    y: originY + box.y / scaleY,
    w: box.w / scaleX,
    h: box.h / scaleY,
  }
}

export function coverOrigin(
  box: ScanBox | null,
  vw: number,
  vh: number,
  elw: number,
  elh: number,
  live: boolean,
): { ox: number; oy: number; zoom: number } {
  if (!live || !box || vw < 1 || vh < 1 || elw < 1 || elh < 1) {
    return { ox: 50, oy: 50, zoom: 1 }
  }
  const s = Math.max(elw / vw, elh / vh)
  const dispW = vw * s
  const dispH = vh * s
  const offX = (elw - dispW) / 2
  const offY = (elh - dispH) / 2
  const cx = offX + (box.x + box.w / 2) * s
  const cy = offY + (box.y + box.h / 2) * s
  const frac = Math.max(box.w / vw, box.h / vh)
  const zoom = Math.min(3.6, Math.max(1.05, 0.88 / Math.max(frac, 0.1)))
  return { ox: (cx / elw) * 100, oy: (cy / elh) * 100, zoom }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
