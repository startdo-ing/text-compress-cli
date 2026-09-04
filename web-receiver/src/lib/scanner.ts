/**
 * Scan QR payloads from a live camera or a still image.
 * Frames are decoded in a web worker (zxing-wasm + BarcodeDetector + jsQR).
 * The main thread downscales or crops to the 2×2 lock so the worker is not
 * chewing a full 1080p frame at display refresh.
 */

import {
  chooseLock,
  gridLock,
  mapBoxToVideo,
  padBox,
  scaleBox,
  type ScanBox,
} from "./scan-geometry"
import type { ScanEngines, ScanHit, WorkerIn, WorkerOut } from "./scan-types"

export type { ScanBox, ScanEngines, ScanHit }
export type ScanHandle = { stop: () => void }

const MISS_UNLOCK = 18
const SCAN_INTERVAL_MS = 70
const SEARCH_MAX = 960
const LOCK_MAX = 880

type GrabMeta = {
  ox: number
  oy: number
  sx: number
  sy: number
  vw: number
  vh: number
  cropped: boolean
}

export async function startCamera(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 24 },
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
  const inflight = new Map<number, GrabMeta>()

  const sendFrame = () => {
    if (stopped || busy || video.readyState < 2) return
    busy = true
    pending = false
    const id = nextId
    nextId += 1
    void grabFrame(video, cropLock)
      .then((grab) => {
        if (!grab || stopped) {
          grab?.bitmap.close()
          busy = false
          return
        }
        inflight.set(id, grab.meta)
        const lock = lockForWorker(cropLock, grab.meta, grab.bitmap.width, grab.bitmap.height)
        const message: WorkerIn = { type: "scan", id, bitmap: grab.bitmap, lock }
        worker.postMessage(message, [grab.bitmap])
      })
      .catch(() => {
        busy = false
      })
  }

  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const data = event.data
    if (data.type !== "result") return
    busy = false
    const grab = inflight.get(data.id)
    inflight.delete(data.id)
    if (stopped) return

    const mapped = grab ? mapHits(data.hits, grab) : data.hits
    const mappedLock = grab ? mapLock(data.lock, mapped, grab) : data.lock

    if (mapped.length === 0) {
      if (cropLock) {
        misses += 1
        if (misses >= MISS_UNLOCK) {
          cropLock = null
          misses = 0
          onLock?.(null)
        }
      }
    } else {
      misses = 0
      const next = chooseLock(cropLock, mappedLock, mapped.length)
      if (next !== cropLock) {
        cropLock = next
        onLock?.(cropLock)
      }
      for (const hit of mapped) onHit(hit)
    }
    if (pending) sendFrame()
  }

  worker.onerror = () => {
    busy = false
  }

  let lastSent = 0
  const tick = (time: number) => {
    if (stopped) return
    raf = requestAnimationFrame(tick)
    if (busy) {
      pending = true
      return
    }
    if (!pending && time - lastSent < SCAN_INTERVAL_MS) return
    lastSent = time
    sendFrame()
  }
  raf = requestAnimationFrame(tick)

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      inflight.clear()
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

function lockForWorker(
  lock: ScanBox | null,
  grab: GrabMeta,
  bw: number,
  bh: number,
): ScanBox | null {
  if (!lock) return null
  if (grab.cropped) return { x: 0, y: 0, w: bw, h: bh }
  return scaleBox(lock, grab.sx, grab.sy)
}

function mapHits(hits: ScanHit[], grab: GrabMeta): ScanHit[] {
  return hits.map((hit) => ({
    text: hit.text,
    box: hit.box ? mapBoxToVideo(hit.box, grab.ox, grab.oy, grab.sx, grab.sy) : undefined,
  }))
}

function mapLock(lock: ScanBox | null, hits: ScanHit[], grab: GrabMeta): ScanBox | null {
  const boxes = hits.map((hit) => hit.box).filter((box): box is ScanBox => Boolean(box))
  const fromHits = gridLock(boxes, grab.vw, grab.vh)
  if (fromHits) return fromHits
  if (!lock) return null
  return mapBoxToVideo(lock, grab.ox, grab.oy, grab.sx, grab.sy)
}

async function grabFrame(
  video: HTMLVideoElement,
  lock: ScanBox | null,
): Promise<{ bitmap: ImageBitmap; meta: GrabMeta } | null> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw < 8 || vh < 8) return null

  if (lock) {
    const cropped = await grabLock(video, lock, vw, vh)
    if (cropped) return cropped
  }

  return grabSearch(video, vw, vh)
}

async function grabLock(
  video: HTMLVideoElement,
  lock: ScanBox,
  vw: number,
  vh: number,
): Promise<{ bitmap: ImageBitmap; meta: GrabMeta } | null> {
  const region = padBox(lock, vw, vh, 0.14)
  const x = Math.max(0, Math.floor(region.x))
  const y = Math.max(0, Math.floor(region.y))
  const w = Math.max(32, Math.min(vw - x, Math.ceil(region.w)))
  const h = Math.max(32, Math.min(vh - y, Math.ceil(region.h)))
  const long = Math.max(w, h, 1)
  const scale = LOCK_MAX / long
  const rw = Math.max(32, Math.round(w * scale))
  const rh = Math.max(32, Math.round(h * scale))
  try {
    const bitmap = await createImageBitmap(video, x, y, w, h, {
      resizeWidth: rw,
      resizeHeight: rh,
      resizeQuality: "medium",
    })
    return {
      bitmap,
      meta: {
        ox: x,
        oy: y,
        sx: rw / w,
        sy: rh / h,
        vw,
        vh,
        cropped: true,
      },
    }
  } catch {
    try {
      const bitmap = await createImageBitmap(video, x, y, w, h)
      return {
        bitmap,
        meta: {
          ox: x,
          oy: y,
          sx: 1,
          sy: 1,
          vw,
          vh,
          cropped: true,
        },
      }
    } catch {
      return null
    }
  }
}

async function grabSearch(
  video: HTMLVideoElement,
  vw: number,
  vh: number,
): Promise<{ bitmap: ImageBitmap; meta: GrabMeta } | null> {
  const scale = Math.min(1, SEARCH_MAX / Math.max(vw, vh))
  const rw = Math.max(1, Math.round(vw * scale))
  const rh = Math.max(1, Math.round(vh * scale))
  try {
    const bitmap = await createImageBitmap(video, {
      resizeWidth: rw,
      resizeHeight: rh,
      resizeQuality: "medium",
    })
    return {
      bitmap,
      meta: { ox: 0, oy: 0, sx: rw / vw, sy: rh / vh, vw, vh, cropped: false },
    }
  } catch {
    const bitmap = await createImageBitmap(video)
    return {
      bitmap,
      meta: { ox: 0, oy: 0, sx: 1, sy: 1, vw, vh, cropped: false },
    }
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
      frameRate: { ideal: 24 },
      ...(Object.keys(advanced).length > 0 ? { advanced: [advanced] } : {}),
    })
  } catch {
    // Some browsers reject individual advanced keys.
  }
}
