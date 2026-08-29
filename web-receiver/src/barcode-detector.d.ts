declare namespace BarcodeDetector {
  function getSupportedFormats(): Promise<string[]>
}

interface DetectedBarcode {
  rawValue: string
  boundingBox?: DOMRectReadOnly
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>
}
