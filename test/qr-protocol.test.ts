import { describe, expect, it } from "vitest"
import { compress } from "../src/api/text.js"
import {
  estimatedMaxFrameBytes,
  qrByteCapacity,
  recommendChunkSize,
  versionForByteCount,
  versionForTerminal,
} from "../src/qr/capacity.js"
import { playQrLoop } from "../src/qr/loop.js"
import {
  createTransfer,
  framesForLap,
  PARITY_GROUP,
  parseFrame,
  SessionAssembler,
  sha256Hex,
} from "../src/qr/protocol.js"
import { renderQr, renderQrGrid } from "../src/qr/render.js"

describe("TCQR protocol", () => {
  it("round-trips a payload from a sequential lap", async () => {
    const payload = compress("QR optical transfer test\n".repeat(40))
    const transfer = await createTransfer({
      payload,
      name: "notes.txt",
      kind: "compressed",
      chunkSize: 40,
      sessionId: "deadbeef",
    })
    const assembler = new SessionAssembler()
    for (const frame of framesForLap(transfer, 0)) {
      assembler.addText(frame)
    }
    await expect(assembler.maybeComplete()).resolves.toBe(payload)
    expect(assembler.header?.name).toBe("notes.txt")
    expect(assembler.header?.sha256).toBe(await sha256Hex(payload))
  })

  it("round-trips shuffled later laps", async () => {
    const payload = "abcdefghijklmnopqrstuvwxyz".repeat(12)
    const transfer = await createTransfer({
      payload,
      name: "paste.txt",
      kind: "raw",
      chunkSize: 10,
      sessionId: "cafebabe",
    })
    const assembler = new SessionAssembler()
    for (const frame of framesForLap(transfer, 3)) {
      assembler.addText(frame)
    }
    await expect(assembler.assemble()).resolves.toBe(payload)
  })

  it("recovers one missing chunk per parity group", async () => {
    const payload = "0123456789".repeat(20)
    const transfer = await createTransfer({
      payload,
      name: "p.txt",
      kind: "raw",
      chunkSize: 10,
      sessionId: "abcd1234",
    })
    const assembler = new SessionAssembler()
    const dropped = new Set<number>()
    for (let group = 0; group * PARITY_GROUP < transfer.chunks.length; group++) {
      dropped.add(group * PARITY_GROUP)
    }

    for (const text of framesForLap(transfer, 0)) {
      const frame = parseFrame(text)
      if (frame?.type === "data" && dropped.has(frame.index)) continue
      assembler.addText(text)
    }

    expect(assembler.chunks.size).toBe(transfer.chunks.length)
    await expect(assembler.assemble()).resolves.toBe(payload)
  })

  it("cannot recover two misses in the same parity group", async () => {
    const payload = "abcdefgh".repeat(16)
    const transfer = await createTransfer({
      payload,
      name: "p.txt",
      kind: "raw",
      chunkSize: 8,
      sessionId: "11111111",
    })
    const assembler = new SessionAssembler()
    for (const text of framesForLap(transfer, 0)) {
      const frame = parseFrame(text)
      if (frame?.type === "data" && (frame.index === 0 || frame.index === 1)) continue
      assembler.addText(text)
    }
    expect(assembler.hasAllChunks).toBe(false)
    await expect(assembler.assemble()).rejects.toThrow(/Missing chunks/)
  })

  it("ignores frames from a different session after the header locks", async () => {
    const a = await createTransfer({
      payload: "alpha-payload-alpha",
      name: "a.txt",
      kind: "raw",
      chunkSize: 6,
      sessionId: "aaaaaaaa",
    })
    const b = await createTransfer({
      payload: "beta-payload-beta!!",
      name: "b.txt",
      kind: "raw",
      chunkSize: 6,
      sessionId: "bbbbbbbb",
    })
    const assembler = new SessionAssembler()
    assembler.addText(framesForLap(a, 0)[0])
    for (const frame of framesForLap(b, 0)) assembler.addText(frame)
    for (const frame of framesForLap(a, 0)) assembler.addText(frame)
    await expect(assembler.assemble()).resolves.toBe("alpha-payload-alpha")
  })

  it("buffers data frames that arrive before the header", async () => {
    const payload = "header-comes-last"
    const transfer = await createTransfer({
      payload,
      name: "late.txt",
      kind: "raw",
      chunkSize: 5,
      sessionId: "99999999",
    })
    const frames = framesForLap(transfer, 0)
    const assembler = new SessionAssembler()
    for (const frame of frames.slice(1)) assembler.addText(frame)
    expect(assembler.header).toBeNull()
    assembler.addText(frames[0])
    await expect(assembler.assemble()).resolves.toBe(payload)
  })

  it("rejects truncated frames", () => {
    expect(parseFrame("TCQR1d|abcd1234|0|5|ab")).toBeNull()
    expect(parseFrame("hello")).toBeNull()
  })

  it("preserves raw text that contains pipes and newlines", async () => {
    const payload = "a|b|c\nline two\n"
    const transfer = await createTransfer({
      payload,
      name: "pipe.txt",
      kind: "raw",
      chunkSize: 4,
      sessionId: "feedfeee",
    })
    const assembler = new SessionAssembler()
    for (const frame of framesForLap(transfer, 0)) assembler.addText(frame)
    await expect(assembler.assemble()).resolves.toBe(payload)
  })
})

describe("QR terminal render", () => {
  it("erases to the end of each row so a smaller frame cannot leave glyphs", () => {
    const qr = renderQr("TCQR1h|abcd1234|n|k|1|40|M|deadbeef")
    const lines = qr.split("\n")
    expect(lines.length).toBeGreaterThan(8)
    for (const line of lines) {
      expect(line.endsWith("\x1b[K")).toBe(true)
    }
  })

  it("keeps the same module grid when a version is locked", () => {
    const version = 8
    const small = renderQr("hi", "M", version)
    const large = renderQr("x".repeat(80), "M", version)
    expect(small.split("\n").length).toBe(large.split("\n").length)
  })

  it("paints four equal-height QRs in a 2×2 grid", () => {
    const grid = renderQrGrid(["a", "b", "c", "d"], "M", 5)
    const single = renderQr("a", "M", 5)
    const lines = grid.split("\n")
    expect(lines.length).toBeGreaterThan(single.split("\n").length)
    for (const line of lines) {
      expect(line.endsWith("\x1b[K")).toBe(true)
    }
    expect(grid.split("\x1b[48;5;231m").length - 1).toBeGreaterThanOrEqual(4)
  })

  it("erases the TTY between frames so leftover rows cannot accumulate", async () => {
    const { PassThrough } = await import("node:stream")
    const chunks: string[] = []
    const stdout = {
      isTTY: true,
      write(value: string) {
        chunks.push(value)
        return true
      },
    } as unknown as NodeJS.WriteStream
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream
    Object.assign(stdin, { isTTY: false })
    const transfer = await createTransfer({
      payload: "abcdefghijklmnopqrstuvwxyz",
      name: "t.txt",
      kind: "raw",
      chunkSize: 8,
      sessionId: "abcdabcd",
    })
    await playQrLoop(transfer, {
      fps: 24,
      ec: "M",
      laps: 1,
      stdout,
      stdin,
      statusLine: () => "status",
    })
    const paints = chunks.filter((c) => c.includes("status"))
    expect(paints.length).toBeGreaterThan(1)
    const heights = paints.map((paint) => paint.split("\n").length)
    expect(new Set(heights).size).toBe(1)
    for (const paint of paints) {
      expect(paint).toContain("\x1b[2J")
      expect(paint).toContain("\x1b[J")
    }
  })
})

describe("QR capacity", () => {
  it("picks a version that fits a typical terminal", () => {
    expect(versionForTerminal({ columns: 80, rows: 24 })).toBeGreaterThanOrEqual(5)
  })

  it("sizes chunks so header, data, and parity fit the 2×2 terminal version", () => {
    const size = { columns: 160, rows: 50 }
    const chunk = recommendChunkSize(size, "M")
    const maxFrame = estimatedMaxFrameBytes(chunk)
    const version = versionForByteCount(maxFrame, "M")
    expect(chunk).toBeGreaterThanOrEqual(1)
    expect(qrByteCapacity(version, "M")).toBeGreaterThanOrEqual(maxFrame)
  })
})
