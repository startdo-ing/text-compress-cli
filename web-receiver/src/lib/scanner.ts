/**
 * Scan QR payloads from a live camera or a still image.
 * Locates the bright QR card, then locks crop and zoom so the
 * viewfinder does not hunt while frames loop.
 */

import jsQR from "jsqr"

export type ScanBox = { x: number; y: number; w: number; h: number }
export type ScanHit = { text: string; box?: ScanBox }
export type ScanHandle = { stop: () => void }

const ZOOM_TARGET = 720
const LOCATE_WIDTH = 480
const MISS_UNLOCK = 24

type Detector = BarcodeDetector | null

export async function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  })
}

export async function startScanner(
  video: HTMLVideoElement,
  onHit: (hit: ScanHit) => void,
  onLock?: (box: ScanBox | null) => void,
): Promise<ScanHandle> {
  const detector = await createDetector()
  let stopped = false
  let busy = false
  let raf = 0
  let cropLock: ScanBox | null = null
  let misses = 0
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  const tick = () => {
    if (stopped) return
    raf = requestAnimationFrame(tick)
    if (busy || video.readyState < 2 || !ctx) return
    busy = true
    void runLockedScan(video, detector, canvas, ctx, cropLock)
      .then((result) => {
        if (stopped) return
        if (cropLock && !result.hit) {
          misses += 1
          if (misses >= MISS_UNLOCK) {
            cropLock = null
            misses = 0
            onLock?.(null)
          }
          return
        }
        misses = 0
        if (result.lock && !cropLock) {
          cropLock = result.lock
          onLock?.(cropLock)
        }
        if (result.hit) onHit(result.hit)
      })
      .finally(() => {
        busy = false
      })
  }
  raf = requestAnimationFrame(tick)

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
    },
  }
}

export async function scanImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  const detector = await createDetector()
  const fakeVideo = {
    videoWidth: bitmap.width,
    videoHeight: bitmap.height,
    readyState: 4,
  } as HTMLVideoElement
  ctx.canvas.width = bitmap.width
  ctx.canvas.height = bitmap.height
  ctx.drawImage(bitmap, 0, 0)
  const hit = await detectFromSource(bitmap, fakeVideo, detector, canvas, ctx)
  return hit?.text ?? null
}

async function runLockedScan(
  video: HTMLVideoElement,
  detector: Detector,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cropLock: ScanBox | null,
): Promise<{ hit: ScanHit | null; lock: ScanBox | null }> {
  const vw = video.videoWidth || 1
  const vh = video.videoHeight || 1
  if (cropLock) {
    const hit = await decodeCrop(video, padBox(cropLock, vw, vh, 0.2), detector, canvas, ctx)
    return { hit, lock: cropLock }
  }
  const hit = await detectFromSource(video, video, detector, canvas, ctx)
  const lock = hit?.box ? padBox(hit.box, vw, vh, 0.18) : null
  return { hit, lock }
}

async function createDetector(): Promise<Detector> {
  if (!("BarcodeDetector" in window)) return null
  try {
    const formats = await BarcodeDetector.getSupportedFormats()
    if (!formats.includes("qr_code")) return null
    return new BarcodeDetector({ formats: ["qr_code"] })
  } catch {
    return null
  }
}

async function detectFromSource(
  source: CanvasImageSource,
  size: { videoWidth: number; videoHeight: number },
  detector: Detector,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<ScanHit | null> {
  const vw = size.videoWidth || 1
  const vh = size.videoHeight || 1

  const native = await detectNative(source, detector)
  if (native) return native

  const locateScale = Math.min(1, LOCATE_WIDTH / vw)
  const lw = Math.max(1, Math.round(vw * locateScale))
  const lh = Math.max(1, Math.round(vh * locateScale))
  canvas.width = lw
  canvas.height = lh
  ctx.drawImage(source, 0, 0, lw, lh)
  const preview = ctx.getImageData(0, 0, lw, lh)
  const bright = findBrightRegion(preview)
  const boxes: ScanBox[] = []
  if (bright) {
    boxes.push(scaleBox(bright, vw / lw, vh / lh))
  }
  boxes.push(centerBox(vw, vh, 0.5), centerBox(vw, vh, 0.32))

  for (const box of boxes) {
    const hit = await decodeCrop(source, box, detector, canvas, ctx)
    if (hit) return hit
  }

  if (bright) return null
  canvas.width = Math.max(1, Math.round(Math.min(vw, 960)))
  canvas.height = Math.max(1, Math.round((canvas.width / vw) * vh))
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return decodeCanvas(canvas, ctx, detector, vw / canvas.width, vh / canvas.height)
}

async function detectNative(
  source: CanvasImageSource,
  detector: Detector,
): Promise<ScanHit | null> {
  if (!detector) return null
  try {
    const codes = await detector.detect(source as ImageBitmapSource)
    const code = codes[0]
    if (!code?.rawValue) return null
    return { text: code.rawValue, box: boxFromDetector(code) }
  } catch {
    return null
  }
}

async function decodeCrop(
  source: CanvasImageSource,
  box: ScanBox,
  detector: Detector,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<ScanHit | null> {
  const side = Math.max(32, Math.max(box.w, box.h))
  const target = Math.max(ZOOM_TARGET, Math.round(side * 2))
  canvas.width = target
  canvas.height = target
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, target, target)
  const hit = await decodeCanvas(canvas, ctx, detector, box.w / target, box.h / target)
  if (!hit) return null
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

async function decodeCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  detector: Detector,
  scaleX: number,
  scaleY: number,
): Promise<ScanHit | null> {
  if (detector) {
    try {
      const codes = await detector.detect(canvas)
      const code = codes[0]
      if (code?.rawValue) {
        const box = boxFromDetector(code)
        return {
          text: code.rawValue,
          box: box ? scaleBox(box, scaleX, scaleY) : undefined,
        }
      }
    } catch {
      // jsQR fallback
    }
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "attemptBoth",
  })
  if (!result?.data) return null
  return {
    text: result.data,
    box: scaleBox(boxFromJsQr(result.location), scaleX, scaleY),
  }
}

function findBrightRegion(image: ImageData): ScanBox | null {
  const { width, height, data } = image
  for (const threshold of [225, 195, 165]) {
    const box = brightBounds(data, width, height, threshold)
    if (!box) continue
    const area = box.w * box.h
    if (area < 18 * 18) continue
    if (area > width * height * 0.88) continue
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
  const xs = [
    location.topLeftCorner.x,
    location.topRightCorner.x,
    location.bottomLeftCorner.x,
    location.bottomRightCorner.x,
  ]
  const ys = [
    location.topLeftCorner.y,
    location.topRightCorner.y,
    location.bottomLeftCorner.y,
    location.bottomRightCorner.y,
  ]
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
