/// <reference lib="webworker" />

import jsQR from "jsqr"
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"
import type { ScanBox, ScanHit, WorkerIn, WorkerOut } from "./scan-types"

const ZOOM_TARGET = 1100
const LOCATE_WIDTH = 480
const MAX_SYMBOLS = 8

type Detector = BarcodeDetector | null

let detector: Detector = null
let zxingReady = false

const zxingFast: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryInvert: true,
  tryRotate: false,
  tryDownscale: true,
  maxNumberOfSymbols: MAX_SYMBOLS,
  textMode: "Plain",
}

const zxingTough: ReaderOptions = {
  ...zxingFast,
  binarizer: "GlobalHistogram",
  tryDenoise: true,
}

void init()

async function init() {
  detector = await createDetector()
  postEngines("ready")
  try {
    await prepareZXingModule({
      fireImmediately: true,
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? wasmUrl : `${prefix}${path}`,
      },
    })
    zxingReady = true
  } catch {
    zxingReady = false
  }
  postEngines("engines")
}

function postEngines(type: "ready" | "engines") {
  post({
    type,
    zxing: zxingReady,
    barcodeDetector: detector !== null,
  })
}

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const { id, bitmap, lock } = event.data
  void scanFrame(bitmap, lock)
    .then((result) => {
      post({ type: "result", id, hits: result.hits, lock: result.lock })
    })
    .catch(() => {
      post({ type: "result", id, hits: [], lock: null })
    })
    .finally(() => {
      bitmap.close()
    })
}

function post(message: WorkerOut) {
  self.postMessage(message)
}

async function scanFrame(
  bitmap: ImageBitmap,
  cropLock: ScanBox | null,
): Promise<{ hits: ScanHit[]; lock: ScanBox | null }> {
  const vw = bitmap.width || 1
  const vh = bitmap.height || 1
  if (cropLock) {
    const tight = await decodeCrop(bitmap, padBox(cropLock, vw, vh, 0.1), "fast")
    if (tight.length >= 2) return { hits: tight, lock: cropLock }
    const wide = await decodeCrop(bitmap, padBox(cropLock, vw, vh, 0.28), "hard")
    if (wide.length > 0) return { hits: wide, lock: cropLock }
    const parts: ScanHit[] = []
    for (const cell of splitQuadrants(cropLock, vw, vh)) {
      parts.push(...(await decodeCrop(bitmap, cell, "fast")))
    }
    return { hits: dedupeHits(parts), lock: cropLock }
  }

  const native = await detectNative(bitmap)
  if (native.length > 0) {
    return { hits: native, lock: unionLock(native, vw, vh) }
  }

  const hits = await detectFromBitmap(bitmap)
  return { hits, lock: unionLock(hits, vw, vh) }
}

async function detectFromBitmap(bitmap: ImageBitmap): Promise<ScanHit[]> {
  const vw = bitmap.width || 1
  const vh = bitmap.height || 1
  const locateScale = Math.min(1, LOCATE_WIDTH / vw)
  const lw = Math.max(1, Math.round(vw * locateScale))
  const lh = Math.max(1, Math.round(vh * locateScale))
  const preview = drawToImage(bitmap, 0, 0, vw, vh, lw, lh)
  const region = findQrRegion(preview)
  const boxes: ScanBox[] = []
  if (region) boxes.push(scaleBox(region, vw / lw, vh / lh))
  boxes.push(centerBox(vw, vh, 0.62), centerBox(vw, vh, 0.4))

  for (let i = 0; i < boxes.length; i += 1) {
    const hits = await decodeCrop(bitmap, boxes[i], i === boxes.length - 1 ? "hard" : "fast")
    if (hits.length > 0) return hits
  }
  return []
}

async function decodeCrop(
  bitmap: ImageBitmap,
  box: ScanBox,
  effort: "fast" | "hard",
): Promise<ScanHit[]> {
  const side = Math.max(32, Math.max(box.w, box.h))
  const target = Math.min(1400, Math.max(ZOOM_TARGET, Math.round(side * 1.4)))
  const image = drawToImage(bitmap, box.x, box.y, box.w, box.h, target, target)
  const hits = await decodeImage(image, box.w / target, box.h / target, effort)
  return hits.map((hit) => ({
    text: hit.text,
    box: hit.box
      ? {
          x: box.x + hit.box.x,
          y: box.y + hit.box.y,
          w: hit.box.w,
          h: hit.box.h,
        }
      : box,
  }))
}

async function decodeImage(
  image: ImageData,
  scaleX: number,
  scaleY: number,
  effort: "fast" | "hard",
): Promise<ScanHit[]> {
  const native = scaleHits(await detectNative(image), scaleX, scaleY)
  if (native.length >= 2) return native

  const zxing = scaleHits(await decodeZxing(image, zxingFast), scaleX, scaleY)
  const merged = dedupeHits([...native, ...zxing])
  if (merged.length >= 2) return merged

  const stretched = stretchContrast(image)
  const zxingContrast = scaleHits(await decodeZxing(stretched, zxingFast), scaleX, scaleY)
  const afterContrast = dedupeHits([...merged, ...zxingContrast])
  if (afterContrast.length > 0 && (effort === "fast" || afterContrast.length >= 2)) {
    return afterContrast
  }

  if (effort === "hard") {
    const tough = scaleHits(await decodeZxing(image, zxingTough), scaleX, scaleY)
    const all = dedupeHits([...afterContrast, ...tough])
    if (all.length > 0) return all
  }

  const js = decodeJsQr(image) ?? decodeJsQr(stretched)
  if (js) return [scaleHit(js, scaleX, scaleY)]
  return afterContrast
}

async function decodeZxing(image: ImageData, options: ReaderOptions): Promise<ScanHit[]> {
  if (!zxingReady) return []
  try {
    const codes = await readBarcodes(image, options)
    return codes
      .filter((item) => item.isValid && item.text)
      .map((code) => ({ text: code.text, box: boxFromPosition(code.position) }))
  } catch {
    return []
  }
}

function decodeJsQr(image: ImageData): ScanHit | null {
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "attemptBoth",
  })
  if (!result?.data) return null
  return { text: result.data, box: boxFromJsQr(result.location) }
}

async function detectNative(source: ImageBitmap | ImageData): Promise<ScanHit[]> {
  if (!detector) return []
  try {
    const codes = await detector.detect(source)
    return codes
      .filter((code) => code.rawValue)
      .map((code) => ({ text: code.rawValue, box: boxFromDetector(code) }))
  } catch {
    return []
  }
}

async function createDetector(): Promise<Detector> {
  if (!("BarcodeDetector" in globalThis)) return null
  try {
    const formats = await BarcodeDetector.getSupportedFormats()
    if (!formats.includes("qr_code")) return null
    return new BarcodeDetector({ formats: ["qr_code"] })
  } catch {
    return null
  }
}

function drawToImage(
  bitmap: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): ImageData {
  const canvas = new OffscreenCanvas(dw, dh)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return new ImageData(dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
  return ctx.getImageData(0, 0, dw, dh)
}

function stretchContrast(src: ImageData): ImageData {
  const { width, height, data } = src
  let min = 255
  let max = 0
  for (let i = 0; i < data.length; i += 16) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    if (luma < min) min = luma
    if (luma > max) max = luma
  }
  const range = Math.max(8, max - min)
  const out = new ImageData(width, height)
  const dest = out.data
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    const v = Math.max(0, Math.min(255, Math.round(((luma - min) / range) * 255)))
    dest[i] = v
    dest[i + 1] = v
    dest[i + 2] = v
    dest[i + 3] = 255
  }
  return out
}

function findQrRegion(image: ImageData): ScanBox | null {
  return findContrastRegion(image) ?? findBrightRegion(image)
}

function findContrastRegion(image: ImageData): ScanBox | null {
  const cols = 16
  const rows = 16
  const { width, height, data } = image
  const cw = width / cols
  const ch = height / rows
  const scores: number[] = []
  let maxScore = 0
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const score = cellVariance(data, width, gx * cw, gy * ch, cw, ch)
      scores.push(score)
      if (score > maxScore) maxScore = score
    }
  }
  if (maxScore < 180) return null
  const cutoff = maxScore * 0.38
  let minX = cols
  let minY = rows
  let maxX = 0
  let maxY = 0
  let count = 0
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      if (scores[gy * cols + gx] < cutoff) continue
      count += 1
      if (gx < minX) minX = gx
      if (gy < minY) minY = gy
      if (gx > maxX) maxX = gx
      if (gy > maxY) maxY = gy
    }
  }
  if (count < 2) return null
  const box = {
    x: minX * cw,
    y: minY * ch,
    w: Math.max(1, (maxX - minX + 1) * cw),
    h: Math.max(1, (maxY - minY + 1) * ch),
  }
  const area = box.w * box.h
  if (area < 18 * 18 || area > width * height * 0.95) return null
  const aspect = box.w / box.h
  if (aspect < 0.42 || aspect > 2.4) return null
  return padBox(box, width, height, 0.16)
}

function cellVariance(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
): number {
  let n = 0
  let sum = 0
  let sum2 = 0
  const x1 = Math.min(width, Math.round(x0 + cw))
  const y1 = Math.round(y0 + ch)
  for (let y = Math.max(0, Math.round(y0)); y < y1; y += 2) {
    for (let x = Math.max(0, Math.round(x0)); x < x1; x += 2) {
      const i = (y * width + x) * 4
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      sum += luma
      sum2 += luma * luma
      n += 1
    }
  }
  if (n < 8) return 0
  const mean = sum / n
  return sum2 / n - mean * mean
}

function findBrightRegion(image: ImageData): ScanBox | null {
  const { width, height, data } = image
  for (const threshold of [225, 195, 165]) {
    const box = brightBounds(data, width, height, threshold)
    if (!box) continue
    const area = box.w * box.h
    if (area < 18 * 18) continue
    if (area > width * height * 0.95) continue
    const aspect = box.w / box.h
    if (aspect < 0.42 || aspect > 2.4) continue
    return padBox(box, width, height, 0.16)
  }
  return null
}

function brightBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): ScanBox | null {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let count = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      if (luma < threshold) continue
      count += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (count < 30) return null
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

function padBox(box: ScanBox, width: number, height: number, padFrac: number): ScanBox {
  const pad = Math.round(Math.max(box.w, box.h) * padFrac)
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  const r = Math.min(width, box.x + box.w + pad)
  const b = Math.min(height, box.y + box.h + pad)
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) }
}

function centerBox(width: number, height: number, frac: number): ScanBox {
  const side = Math.max(32, Math.round(Math.min(width, height) * frac))
  return {
    x: Math.max(0, Math.round((width - side) / 2)),
    y: Math.max(0, Math.round((height - side) / 2)),
    w: Math.min(side, width),
    h: Math.min(side, height),
  }
}

function scaleBox(box: ScanBox, scaleX: number, scaleY: number): ScanBox {
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    w: box.w * scaleX,
    h: box.h * scaleY,
  }
}

function scaleHit(hit: ScanHit, scaleX: number, scaleY: number): ScanHit {
  return {
    text: hit.text,
    box: hit.box ? scaleBox(hit.box, scaleX, scaleY) : undefined,
  }
}

function scaleHits(hits: ScanHit[], scaleX: number, scaleY: number): ScanHit[] {
  return hits.map((hit) => scaleHit(hit, scaleX, scaleY))
}

function dedupeHits(hits: ScanHit[]): ScanHit[] {
  const seen = new Set<string>()
  const out: ScanHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.text)) continue
    seen.add(hit.text)
    out.push(hit)
  }
  return out
}

function unionLock(hits: ScanHit[], width: number, height: number): ScanBox | null {
  const boxes = hits.map((hit) => hit.box).filter((box): box is ScanBox => Boolean(box))
  if (boxes.length === 0) return null
  return padBox(unionBoxes(boxes), width, height, boxes.length >= 2 ? 0.1 : 0.18)
}

function unionBoxes(boxes: ScanBox[]): ScanBox {
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

function splitQuadrants(box: ScanBox, width: number, height: number): ScanBox[] {
  const overlap = Math.round(Math.min(box.w, box.h) * 0.08)
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
  return cells.map((cell) => ({
    x: Math.max(0, cell.x),
    y: Math.max(0, cell.y),
    w: Math.max(1, Math.min(width, cell.x + cell.w) - Math.max(0, cell.x)),
    h: Math.max(1, Math.min(height, cell.y + cell.h) - Math.max(0, cell.y)),
  }))
}

function boxFromDetector(code: DetectedBarcode): ScanBox | undefined {
  const bb = code.boundingBox
  if (!bb) return undefined
  return { x: bb.x, y: bb.y, w: bb.width, h: bb.height }
}

function boxFromJsQr(location: {
  topLeftCorner: { x: number; y: number }
  topRightCorner: { x: number; y: number }
  bottomLeftCorner: { x: number; y: number }
  bottomRightCorner: { x: number; y: number }
}): ScanBox {
  return boxFromCorners([
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomLeftCorner,
    location.bottomRightCorner,
  ])
}

function boxFromPosition(position: {
  topLeft: { x: number; y: number }
  topRight: { x: number; y: number }
  bottomLeft: { x: number; y: number }
  bottomRight: { x: number; y: number }
}): ScanBox {
  return boxFromCorners([
    position.topLeft,
    position.topRight,
    position.bottomLeft,
    position.bottomRight,
  ])
}

function boxFromCorners(points: { x: number; y: number }[]): ScanBox {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
