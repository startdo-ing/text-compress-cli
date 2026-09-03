export type ScanBox = { x: number; y: number; w: number; h: number }
export type ScanHit = { text: string; box?: ScanBox }

export type WorkerIn = {
  type: "scan"
  id: number
  bitmap: ImageBitmap
  lock: ScanBox | null
}

export type ScanEngines = {
  worker: boolean
  zxing: boolean
  barcodeDetector: boolean
  settled: boolean
}

export type WorkerOut =
  | { type: "ready"; zxing: boolean; barcodeDetector: boolean }
  | { type: "engines"; zxing: boolean; barcodeDetector: boolean }
  | { type: "result"; id: number; hits: ScanHit[]; lock: ScanBox | null }
