/**
 * Scan QR payloads from a live camera or a still image.
 * Frames are decoded in a web worker (zxing-wasm + BarcodeDetector + jsQR)
 * so the UI thread can keep grabbing the latest 8fps sender frame.
 */

import type { ScanBox, ScanEngines, ScanHit, WorkerIn, WorkerOut } from "./scan-types"

export type { ScanBox, ScanEngines, ScanHit }
export type ScanHandle = { stop: () => void }

const MISS_UNLOCK = 24

export async function startCamera(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  })
  await tuneCamera(stream)
  return stream
}

export async function startScanner(
  video: HTMLVideoElement,
  onHit: (hit: ScanHit) => void,
  onLock?: (box: ScanBox | null) => void,
  onEngines?: (engines: ScanEngines) => void,
): Promise<ScanHandle> {
  const worker = spawnWorker(onEngines)
  await waitReady(worker)
  let stopped = false
  let busy = false
  let pending = false
  let raf = 0
  let nextId = 1
  let cropLock: ScanBox | null = null
  let misses = 0

  const sendFrame = () => {
    if (stopped || busy || video.readyState < 2) return
    busy = true
    pending = false
    const id = nextId
    nextId += 1
    void createImageBitmap(video)
      .then((bitmap) => {
        if (stopped) {
          bitmap.close()
          busy = false
          return
        }
        const message: WorkerIn = { type: "scan", id, bitmap, lock: cropLock }
        worker.postMessage(message, [bitmap])
      })
      .catch(() => {
        busy = false
      })
  }

  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const data = event.data
    if (data.type !== "result") return
    busy = false
    if (stopped) return
    if (cropLock && data.hits.length === 0) {
      misses += 1
      if (misses >= MISS_UNLOCK) {
        cropLock = null
        misses = 0
        onLock?.(null)
      }
    } else {
      misses = 0
      if (data.lock) {
        if (!cropLock || (data.hits.length >= 2 && boxArea(data.lock) > boxArea(cropLock))) {
          cropLock = data.lock
          onLock?.(cropLock)
        }
      }
      for (const hit of data.hits) onHit(hit)
    }
    if (pending) sendFrame()
  }

  worker.onerror = () => {
    busy = false
  }

  const tick = () => {
    if (stopped) return
    raf = requestAnimationFrame(tick)
    if (busy) {
      pending = true
      return
    }
    sendFrame()
  }
  raf = requestAnimationFrame(tick)

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      worker.terminate()
    },
  }
}

export async function scanImageFile(file: File): Promise<string[]> {
  const bitmap = await createImageBitmap(file)
  const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" })
  try {
    await waitReady(worker)
    return await new Promise((resolve) => {
      const onMessage = (event: MessageEvent<WorkerOut>) => {
        if (event.data.type !== "result") return
        worker.removeEventListener("message", onMessage)
        resolve(event.data.hits.map((hit) => hit.text))
      }
      worker.addEventListener("message", onMessage)
      const message: WorkerIn = { type: "scan", id: 1, bitmap, lock: null }
      worker.postMessage(message, [bitmap])
    })
  } finally {
    worker.terminate()
  }
}

function spawnWorker(onEngines?: (engines: ScanEngines) => void): Worker {
  const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" })
  worker.addEventListener("message", (event: MessageEvent<WorkerOut>) => {
    const data = event.data
    if (data.type !== "ready" && data.type !== "engines") return
    onEngines?.(enginesFrom(data))
  })
  worker.addEventListener("error", () => {
    onEngines?.({ worker: false, zxing: false, barcodeDetector: false, settled: true })
  })
  return worker
}

function boxArea(box: ScanBox): number {
  return box.w * box.h
}

function enginesFrom(data: Extract<WorkerOut, { type: "ready" | "engines" }>): ScanEngines {
  return {
    worker: true,
    zxing: data.zxing,
    barcodeDetector: data.barcodeDetector,
    settled: data.type === "engines",
  }
}

function waitReady(worker: Worker): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000)
    const onMessage = (event: MessageEvent<WorkerOut>) => {
      if (event.data.type !== "ready") return
      clearTimeout(timer)
      worker.removeEventListener("message", onMessage)
      resolve()
    }
    worker.addEventListener("message", onMessage)
  })
}

type CameraCaps = MediaTrackCapabilities & {
  focusMode?: string[]
  exposureMode?: string[]
  whiteBalanceMode?: string[]
}

async function tuneCamera(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  if (!track?.getCapabilities) return
  const caps = track.getCapabilities() as CameraCaps
  const advanced: Record<string, string> = {}
  if (caps.focusMode?.includes("continuous")) advanced.focusMode = "continuous"
  else if (caps.focusMode?.includes("auto")) advanced.focusMode = "auto"
  if (caps.exposureMode?.includes("continuous")) advanced.exposureMode = "continuous"
  if (caps.whiteBalanceMode?.includes("continuous")) advanced.whiteBalanceMode = "continuous"
  try {
    await track.applyConstraints({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
      ...(Object.keys(advanced).length > 0 ? { advanced: [advanced] } : {}),
    })
  } catch {
    // Some browsers reject individual advanced keys.
  }
}
