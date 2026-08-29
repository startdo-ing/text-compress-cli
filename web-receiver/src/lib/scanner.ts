/**
 * Scan QR payloads from a live camera or a still image.
 * Uses BarcodeDetector when the browser has it, otherwise jsQR on a canvas.
 */

import jsQR from "jsqr"

export type ScanHandle = { stop: () => void }

export async function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  })
}

export async function startScanner(
  video: HTMLVideoElement,
  onText: (text: string) => void,
): Promise<ScanHandle> {
  const detector = await createDetector()
  let stopped = false
  let busy = false
  let raf = 0
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  const tick = () => {
    if (stopped) return
    raf = requestAnimationFrame(tick)
    if (busy || video.readyState < 2) return
    busy = true
    void detectFrame(video, detector, canvas, ctx)
      .then((text) => {
        if (text && !stopped) onText(text)
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
  const max = 1280
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const detector = await createDetector()
  return detectFromCanvas(canvas, ctx, detector)
}

type Detector = BarcodeDetector | null

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

async function detectFrame(
  video: HTMLVideoElement,
  detector: Detector,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D | null,
): Promise<string | null> {
  if (detector) {
    try {
      const codes = await detector.detect(video)
      const raw = codes[0]?.rawValue
      if (raw) return raw
    } catch {
      // fall through to jsQR
    }
  }
  if (!ctx) return null
  const max = 640
  const scale = Math.min(1, max / Math.max(video.videoWidth || 1, video.videoHeight || 1))
  canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale))
  canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale))
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return detectFromCanvas(canvas, ctx, null)
}

function detectFromCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  detector: Detector,
): Promise<string | null> | string | null {
  if (detector) {
    return detector.detect(canvas).then((codes) => codes[0]?.rawValue ?? null)
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "attemptBoth",
  })
  return result?.data ?? null
}
