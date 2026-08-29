/**
 * @module qr/protocol
 *
 * TCQR v1 — one-way optical transfer of a UTF-8 payload via looping QR frames.
 *
 * Cameras drop frames, so this is not a naive "play once" slideshow:
 *
 * - **Header refresh** — session metadata is re-emitted every few data frames
 * - **Shuffled laps** — each loop permutes chunk order so periodic dropouts
 *   do not always miss the same index
 * - **XOR parity** — groups of {@link PARITY_GROUP} chunks carry one parity
 *   frame that recovers a single miss in that group
 * - **SHA-256** — the assembled payload is hashed before it is trusted
 *
 * Frame text is pipe-delimited with explicit payload lengths so raw files
 * may contain `|` or newlines. This module is isomorphic (Node 18+ and
 * browsers) — no `node:` imports.
 */

export const PROTOCOL_VERSION = 1
export const PARITY_GROUP = 8
export const HEADER_EVERY = 8

export type PayloadKind = "compressed" | "raw"
export type ErrorCorrection = "L" | "M" | "Q" | "H"

export interface HeaderFrame {
  type: "header"
  version: 1
  sessionId: string
  chunkCount: number
  chunkSize: number
  payloadChars: number
  sha256: string
  kind: PayloadKind
  name: string
}

export interface DataFrame {
  type: "data"
  version: 1
  sessionId: string
  index: number
  chunk: string
}

export interface ParityFrame {
  type: "parity"
  version: 1
  sessionId: string
  group: number
  xor: Uint16Array
}

export type Frame = HeaderFrame | DataFrame | ParityFrame

export interface Transfer {
  header: HeaderFrame
  chunks: string[]
  parities: Uint16Array[]
}

export type AssemblerStatus =
  | { state: "empty" }
  | { state: "collecting"; header: HeaderFrame; received: number; needed: number }
  | { state: "complete"; header: HeaderFrame; payload: string }

/** Generate an 8-character hex session id. */
export function randomSessionId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** SHA-256 of the UTF-8 encoding of `text`, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return toHex(new Uint8Array(hash))
}

/**
 * Split a payload into character-sized chunks, compute parity, and hash.
 *
 * `chunkSize` is characters (JS string length), not bytes — compressed
 * text-compress output is ASCII, so the two coincide there.
 */
export async function createTransfer(options: {
  payload: string
  name: string
  kind: PayloadKind
  chunkSize: number
  sessionId?: string
}): Promise<Transfer> {
  const { payload, name, kind } = options
  const chunkSize = options.chunkSize
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`QR chunk size must be a positive integer, got ${chunkSize}.`)
  }

  const chunks = splitChunks(payload, chunkSize)
  const header: HeaderFrame = {
    type: "header",
    version: 1,
    sessionId: options.sessionId ?? randomSessionId(),
    chunkCount: chunks.length,
    chunkSize,
    payloadChars: payload.length,
    sha256: await sha256Hex(payload),
    kind,
    name: name || "payload.txt",
  }

  const groupCount = Math.ceil(chunks.length / PARITY_GROUP)
  const parities: Uint16Array[] = []
  for (let group = 0; group < groupCount; group++) {
    parities.push(xorGroup(chunks, group, chunkSize))
  }

  return { header, chunks, parities }
}

export function encodeHeader(header: HeaderFrame): string {
  const kind = header.kind === "compressed" ? "c" : "r"
  return [
    "TCQR1h",
    header.sessionId,
    String(header.chunkCount),
    String(header.chunkSize),
    String(header.payloadChars),
    header.sha256,
    kind,
    String(header.name.length),
    header.name,
  ].join("|")
}

export function encodeData(frame: DataFrame): string {
  return [
    "TCQR1d",
    frame.sessionId,
    String(frame.index),
    String(frame.chunk.length),
    frame.chunk,
  ].join("|")
}

export function encodeParity(frame: ParityFrame): string {
  const body = u16LeToB64(frame.xor)
  return ["TCQR1p", frame.sessionId, String(frame.group), String(body.length), body].join("|")
}

/** Parse a scanned QR string. Returns `null` when the text is not a TCQR frame. */
export function parseFrame(text: string): Frame | null {
  const raw = text.trim()
  if (!raw.startsWith("TCQR1")) return null
  if (raw.startsWith("TCQR1h|")) return parseHeader(raw)
  if (raw.startsWith("TCQR1d|")) return parseData(raw)
  if (raw.startsWith("TCQR1p|")) return parseParity(raw)
  return null
}

/**
 * Ordered QR strings for one carousel lap.
 *
 * Lap 0 is sequential (easier first pass). Later laps shuffle data order
 * using a seed derived from the session id so sender and tests stay
 * deterministic per lap.
 */
export function framesForLap(transfer: Transfer, lap: number): string[] {
  const { header, chunks } = transfer
  const indices = [...Array(chunks.length).keys()]
  if (lap > 0) {
    const rng = mulberry32(seedFromSession(header.sessionId) + lap)
    shuffleInPlace(indices, rng)
  }

  const out: string[] = [encodeHeader(header)]
  for (let k = 0; k < indices.length; k++) {
    if (k > 0 && k % HEADER_EVERY === 0) out.push(encodeHeader(header))
    const index = indices[k]
    out.push(
      encodeData({
        type: "data",
        version: 1,
        sessionId: header.sessionId,
        index,
        chunk: chunks[index],
      }),
    )
  }
  for (let group = 0; group < transfer.parities.length; group++) {
    out.push(
      encodeParity({
        type: "parity",
        version: 1,
        sessionId: header.sessionId,
        group,
        xor: transfer.parities[group],
      }),
    )
  }
  return out
}

/** Collect scanned frames until the payload verifies. */
export class SessionAssembler {
  header: HeaderFrame | null = null
  readonly chunks = new Map<number, string>()
  readonly parities = new Map<number, Uint16Array>()
  readonly orphans = new Map<
    string,
    { chunks: Map<number, string>; parities: Map<number, Uint16Array> }
  >()
  private completePayload: string | null = null

  /** Ingest one QR string. Unknown text is ignored. */
  addText(text: string): void {
    const frame = parseFrame(text)
    if (frame) this.addFrame(frame)
  }

  addFrame(frame: Frame): void {
    if (this.completePayload !== null) return

    if (frame.type === "header") {
      this.acceptHeader(frame)
      return
    }

    if (this.header && frame.sessionId !== this.header.sessionId) return

    if (!this.header) {
      this.bufferOrphan(frame)
      return
    }

    this.storeDataOrParity(frame)
    this.tryRecover()
  }

  get received(): number {
    return this.chunks.size
  }

  get needed(): number {
    return this.header?.chunkCount ?? 0
  }

  get status(): AssemblerStatus {
    if (this.completePayload !== null && this.header) {
      return { state: "complete", header: this.header, payload: this.completePayload }
    }
    if (!this.header) return { state: "empty" }
    return {
      state: "collecting",
      header: this.header,
      received: this.chunks.size,
      needed: this.header.chunkCount,
    }
  }

  /**
   * Concatenate chunks and verify length + hash.
   * @throws if incomplete or hash mismatch
   */
  async assemble(): Promise<string> {
    if (!this.header) throw new Error("No QR header received yet.")
    this.tryRecover()
    if (this.chunks.size !== this.header.chunkCount) {
      throw new Error(`Missing chunks: ${this.chunks.size}/${this.header.chunkCount}.`)
    }
    const payload = this.concat()
    if (payload.length !== this.header.payloadChars) {
      throw new Error(
        `Assembled length ${payload.length} does not match header ${this.header.payloadChars}.`,
      )
    }
    const digest = await sha256Hex(payload)
    if (digest !== this.header.sha256) {
      throw new Error("SHA-256 mismatch. The transfer was corrupted — send again.")
    }
    this.completePayload = payload
    return payload
  }

  /** True when every chunk is present (including parity-recovered ones). */
  get hasAllChunks(): boolean {
    return this.header !== null && this.chunks.size === this.header.chunkCount
  }

  /** Assemble when every chunk is in; otherwise `null`. */
  async maybeComplete(): Promise<string | null> {
    if (this.completePayload !== null) return this.completePayload
    if (!this.hasAllChunks) return null
    return this.assemble()
  }

  /** True after a successful {@link assemble}. */
  get isComplete(): boolean {
    return this.completePayload !== null
  }

  reset(): void {
    this.header = null
    this.chunks.clear()
    this.parities.clear()
    this.orphans.clear()
    this.completePayload = null
  }

  private acceptHeader(frame: HeaderFrame): void {
    if (this.header) {
      if (frame.sessionId !== this.header.sessionId) return
      return
    }
    this.header = frame
    const orphan = this.orphans.get(frame.sessionId)
    if (orphan) {
      for (const [index, chunk] of orphan.chunks) this.chunks.set(index, chunk)
      for (const [group, xor] of orphan.parities) this.parities.set(group, xor)
      this.orphans.delete(frame.sessionId)
    }
    this.tryRecover()
  }

  private bufferOrphan(frame: DataFrame | ParityFrame): void {
    let bucket = this.orphans.get(frame.sessionId)
    if (!bucket) {
      bucket = { chunks: new Map(), parities: new Map() }
      this.orphans.set(frame.sessionId, bucket)
    }
    if (frame.type === "data") bucket.chunks.set(frame.index, frame.chunk)
    else bucket.parities.set(frame.group, frame.xor)
  }

  private storeDataOrParity(frame: DataFrame | ParityFrame): void {
    if (frame.type === "data") {
      if (frame.index < 0 || (this.header && frame.index >= this.header.chunkCount)) return
      this.chunks.set(frame.index, frame.chunk)
      return
    }
    this.parities.set(frame.group, frame.xor)
  }

  private tryRecover(): void {
    if (!this.header) return
    const { chunkCount, chunkSize, payloadChars } = this.header
    const groupCount = Math.ceil(chunkCount / PARITY_GROUP)
    for (let group = 0; group < groupCount; group++) {
      const xor = this.parities.get(group)
      if (!xor) continue
      const start = group * PARITY_GROUP
      const end = Math.min(start + PARITY_GROUP, chunkCount)
      const missing: number[] = []
      for (let i = start; i < end; i++) {
        if (!this.chunks.has(i)) missing.push(i)
      }
      if (missing.length !== 1) continue
      const lost = missing[0]
      const recovered = recoverChunk(
        this.chunks,
        xor,
        group,
        chunkCount,
        chunkSize,
        payloadChars,
        lost,
      )
      if (recovered !== null) this.chunks.set(lost, recovered)
    }
  }

  private concat(): string {
    if (!this.header) return ""
    const parts: string[] = []
    for (let i = 0; i < this.header.chunkCount; i++) {
      const chunk = this.chunks.get(i)
      if (chunk === undefined) throw new Error(`Missing chunk ${i}.`)
      parts.push(chunk)
    }
    return parts.join("")
  }
}

export function splitChunks(payload: string, chunkSize: number): string[] {
  if (payload.length === 0) return [""]
  const chunks: string[] = []
  for (let i = 0; i < payload.length; i += chunkSize) {
    chunks.push(payload.slice(i, i + chunkSize))
  }
  return chunks
}

function xorGroup(chunks: string[], group: number, chunkSize: number): Uint16Array {
  const start = group * PARITY_GROUP
  const end = Math.min(start + PARITY_GROUP, chunks.length)
  const xor = new Uint16Array(chunkSize)
  for (let i = start; i < end; i++) {
    xorStringInto(xor, chunks[i])
  }
  return xor
}

function recoverChunk(
  chunks: Map<number, string>,
  parity: Uint16Array,
  group: number,
  chunkCount: number,
  chunkSize: number,
  payloadChars: number,
  lost: number,
): string | null {
  const start = group * PARITY_GROUP
  const end = Math.min(start + PARITY_GROUP, chunkCount)
  const xor = new Uint16Array(parity)
  for (let i = start; i < end; i++) {
    if (i === lost) continue
    const chunk = chunks.get(i)
    if (chunk === undefined) return null
    xorStringInto(xor, chunk)
  }
  const length = lost === chunkCount - 1 ? payloadChars - chunkSize * (chunkCount - 1) : chunkSize
  if (length < 0 || length > chunkSize) return null
  return u16ToString(xor, length)
}

function xorStringInto(xor: Uint16Array, chunk: string): void {
  const n = Math.min(xor.length, chunk.length)
  for (let i = 0; i < n; i++) {
    xor[i] ^= chunk.charCodeAt(i)
  }
}

function u16ToString(data: Uint16Array, length: number): string {
  let out = ""
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(data[i] ?? 0)
  }
  return out
}

function parseHeader(raw: string): HeaderFrame | null {
  const parts = splitLimited(raw, "|", 8)
  if (!parts) return null
  const [, sessionId, nRaw, zRaw, charsRaw, sha256, kindRaw, nameLenRaw, name] = parts
  const chunkCount = toInt(nRaw)
  const chunkSize = toInt(zRaw)
  const payloadChars = toInt(charsRaw)
  const nameLen = toInt(nameLenRaw)
  if (chunkCount === null || chunkSize === null || payloadChars === null || nameLen === null) {
    return null
  }
  if (name.length !== nameLen) return null
  if (sha256.length !== 64 || !/^[0-9a-f]+$/.test(sha256)) return null
  if (kindRaw !== "c" && kindRaw !== "r") return null
  if (!/^[0-9a-f]{8}$/.test(sessionId)) return null
  return {
    type: "header",
    version: 1,
    sessionId,
    chunkCount,
    chunkSize,
    payloadChars,
    sha256,
    kind: kindRaw === "c" ? "compressed" : "raw",
    name,
  }
}

function parseData(raw: string): DataFrame | null {
  const parts = splitLimited(raw, "|", 4)
  if (!parts) return null
  const [, sessionId, indexRaw, lenRaw, chunk] = parts
  const index = toInt(indexRaw)
  const len = toInt(lenRaw)
  if (index === null || len === null) return null
  if (chunk.length !== len) return null
  if (!/^[0-9a-f]{8}$/.test(sessionId)) return null
  return { type: "data", version: 1, sessionId, index, chunk }
}

function parseParity(raw: string): ParityFrame | null {
  const parts = splitLimited(raw, "|", 4)
  if (!parts) return null
  const [, sessionId, groupRaw, lenRaw, body] = parts
  const group = toInt(groupRaw)
  const len = toInt(lenRaw)
  if (group === null || len === null) return null
  if (body.length !== len) return null
  if (!/^[0-9a-f]{8}$/.test(sessionId)) return null
  try {
    const xor = b64ToU16Le(body)
    return { type: "parity", version: 1, sessionId, group, xor }
  } catch {
    return null
  }
}

/** Split `s` on `sep` into `count + 1` parts; the last part keeps remaining seps. */
function splitLimited(s: string, sep: string, count: number): string[] | null {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const at = s.indexOf(sep, start)
    if (at === -1) return null
    parts.push(s.slice(start, at))
    start = at + sep.length
  }
  parts.push(s.slice(start))
  return parts
}

function toInt(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null
  return Number(value)
}

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

function u16LeToB64(data: Uint16Array): string {
  const bytes = new Uint8Array(data.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < data.length; i++) {
    view.setUint16(i * 2, data[i], true)
  }
  return bytesToB64(bytes)
}

function b64ToU16Le(b64: string): Uint16Array {
  const bytes = b64ToBytes(b64)
  if (bytes.length % 2 !== 0) throw new Error("odd parity length")
  const data = new Uint16Array(bytes.length / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getUint16(i * 2, true)
  }
  return data
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function mulberry32(a: number): () => number {
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromSession(sessionId: string): number {
  return Number.parseInt(sessionId, 16) >>> 0
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}
