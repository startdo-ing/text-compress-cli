/// <reference lib="webworker" />

import jsQR from "jsqr"
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"
import {
  centerBox,
  gridLock,
  padBox,
  scaleBox,
  splitQuadrants,
  type ScanBox,
} from "./scan-geometry"
import type { ScanHit, WorkerIn, WorkerOut } from "./scan-types"

const DECODE_MAX = 880
const LOCATE_WIDTH = 400
const MAX_SYMBOLS = 4

type Detector = BarcodeDetector | null

let detector: Detector = null
let zxingReady = false
let workCanvas: OffscreenCanvas | null = null
let workCtx: OffscreenCanvasRenderingContext2D | null = null

const zxingFast: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: false,
  tryInvert: true,
  tryRotate: false,
  tryDownscale: true,
  maxNumberOfSymbols: MAX_SYMBOLS,
  textMode: "Plain",
}

const zxingTough: ReaderOptions = {
  ...zxingFast,
  tryHarder: true,
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
    return scanLocked(bitmap, cropLock, vw, vh)
  }
  return scanSearch(bitmap, vw, vh)
}

async function scanLocked(
  bitmap: ImageBitmap,
  cropLock: ScanBox,
  vw: number,
  vh: number,
): Promise<{ hits: ScanHit[]; lock: ScanBox | null }> {
  let hits = await decodeCrop(bitmap, padBox(cropLock, vw, vh, 0.04), "fast")
  if (hits.length < 4) {
    const guess = gridLock(hitBoxes(hits), vw, vh, cropLock) ?? cropLock
    hits = dedupeHits([...hits, ...(await decodeQuadrants(bitmap, guess, vw, vh))])
  }
  if (hits.length === 0) {
    hits = await decodeCrop(bitmap, padBox(cropLock, vw, vh, 0.28), "fast")
    if (hits.length > 0 && hits.length < 4) {
      const guess = gridLock(hitBoxes(hits), vw, vh, cropLock) ?? cropLock
      hits = dedupeHits([...hits, ...(await decodeQuadrants(bitmap, guess, vw, vh))])
    }
  }
  if (hits.length === 0) {
    hits = await decodeCrop(bitmap, padBox(cropLock, vw, vh, 0.12), "hard")
  }
  return {
    hits,
    lock: gridLock(hitBoxes(hits), vw, vh, cropLock) ?? cropLock,
  }
}

async function scanSearch(
  bitmap: ImageBitmap,
  vw: number,
  vh: number,
): Promise<{ hits: ScanHit[]; lock: ScanBox | null }> {
  const locateScale = Math.min(1, LOCATE_WIDTH / vw)
  const lw = Math.max(1, Math.round(vw * locateScale))
  const lh = Math.max(1, Math.round(vh * locateScale))
  const preview = drawToImage(bitmap, 0, 0, vw, vh, lw, lh)
  const region = findQrRegion(preview)
  const hint = region ? scaleBox(region, vw / lw, vh / lh) : null

  const boxes: ScanBox[] = []
  if (hint) boxes.push(hint)
  boxes.push(centerBox(vw, vh, 0.62), centerBox(vw, vh, 0.4))

  let best: ScanHit[] = []
  for (const box of boxes) {
    const hits = await decodeCrop(bitmap, box, "fast")
    if (hits.length > best.length) best = hits
    if (best.length >= 4) break
  }

  if (best.length > 0 && best.length < 4) {
    const guess = gridLock(hitBoxes(best), vw, vh, hint)
    if (guess) {
      best = dedupeHits([...best, ...(await decodeQuadrants(bitmap, guess, vw, vh))])
    }
  }

  if (best.length === 0 && boxes[0]) {
    best = await decodeCrop(bitmap, boxes[0], "hard")
  }

  return {
    hits: best,
    lock: best.length > 0 ? gridLock(hitBoxes(best), vw, vh, hint) : null,
  }
}

async function decodeQuadrants(
  bitmap: ImageBitmap,
  box: ScanBox,
  vw: number,
  vh: number,
): Promise<ScanHit[]> {
  const jobs = splitQuadrants(box, vw, vh).map((cell) => {
    const { dw, dh } = targetSize(cell)
    return {
      cell,
      image: drawToImage(bitmap, cell.x, cell.y, cell.w, cell.h, dw, dh),
      scaleX: cell.w / dw,
      scaleY: cell.h / dh,
    }
  })
  const decoded = await Promise.all(
    jobs.map((job) => decodeImage(job.image, job.scaleX, job.scaleY, "fast")),
  )
  const hits: ScanHit[] = []
  for (let i = 0; i < jobs.length; i += 1) {
    const cell = jobs[i].cell
    for (const hit of decoded[i]) {
      hits.push(offsetHit(hit, cell))
    }
  }
  return dedupeHits(hits)
}

async function decodeCrop(
  bitmap: ImageBitmap,
  box: ScanBox,
  effort: "fast" | "hard",
): Promise<ScanHit[]> {
  const { dw, dh } = targetSize(box)
  const image = drawToImage(bitmap, box.x, box.y, box.w, box.h, dw, dh)
  const hits = await decodeImage(image, box.w / dw, box.h / dh, effort)
  return hits.map((hit) => offsetHit(hit, box))
}

function targetSize(box: ScanBox): { dw: number; dh: number } {
  const long = Math.max(box.w, box.h, 1)
  const scale = DECODE_MAX / long
  return {
    dw: Math.max(32, Math.round(box.w * scale)),
    dh: Math.max(32, Math.round(box.h * scale)),
  }
}

function offsetHit(hit: ScanHit, box: ScanBox): ScanHit {
  return {
    text: hit.text,
    box: hit.box
      ? {
          x: box.x + hit.box.x,
          y: box.y + hit.box.y,
          w: hit.box.w,
          h: hit.box.h,
        }
      : box,
  }
}

async function decodeImage(
  image: ImageData,
  scaleX: number,
  scaleY: number,
  effort: "fast" | "hard",
): Promise<ScanHit[]> {
  const native = scaleHits(await detectNative(image), scaleX, scaleY)
  if (native.length >= 4) return native

  const zxing = scaleHits(await decodeZxing(image, zxingFast), scaleX, scaleY)
  const merged = dedupeHits([...native, ...zxing])
  if (merged.length >= 4 || (effort === "fast" && merged.length > 0)) return merged

  if (effort === "hard") {
    const stretched = stretchContrast(image)
    const zxingContrast = scaleHits(await decodeZxing(stretched, zxingFast), scaleX, scaleY)
    const afterContrast = dedupeHits([...merged, ...zxingContrast])
    if (afterContrast.length >= 2) return afterContrast

    const tough = scaleHits(await decodeZxing(image, zxingTough), scaleX, scaleY)
    const all = dedupeHits([...afterContrast, ...tough])
    if (all.length > 0) return all

    const js = decodeJsQr(image) ?? decodeJsQr(stretched)
    if (js) return [scaleHit(js, scaleX, scaleY)]
    return afterContrast
  }

  return merged
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
  const ctx = getCtx(dw, dh)
  if (!ctx) return new ImageData(dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "medium"
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
  return ctx.getImageData(0, 0, dw, dh)
}

function getCtx(dw: number, dh: number): OffscreenCanvasRenderingContext2D | null {
  if (!workCanvas || !workCtx) {
    workCanvas = new OffscreenCanvas(dw, dh)
    workCtx = workCanvas.getContext("2d", { willReadFrequently: true })
    return workCtx
  }
  if (workCanvas.width !== dw || workCanvas.height !== dh) {
    workCanvas.width = dw
    workCanvas.height = dh
  }
  return workCtx
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
  if (maxScore < 140) return null
  const cutoff = maxScore * 0.22
  const neighbor = maxScore * 0.12
  const hot: boolean[] = scores.map((score) => score >= cutoff)
  const marked = hot.slice()
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      if (!hot[gy * cols + gx]) continue
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = gx + dx
        const y = gy + dy
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue
        if (scores[y * cols + x] >= neighbor) marked[y * cols + x] = true
      }
    }
  }
  let minX = cols
  let minY = rows
  let maxX = 0
  let maxY = 0
  let count = 0
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      if (!marked[gy * cols + gx]) continue
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

function hitBoxes(hits: ScanHit[]): ScanBox[] {
  return hits.map((hit) => hit.box).filter((box): box is ScanBox => Boolean(box))
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
