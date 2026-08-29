import { describe, expect, it } from "vitest"
import { compress } from "../src/api/text.js"
import { recommendChunkSize, versionForTerminal } from "../src/qr/capacity.js"
import {
  createTransfer,
  framesForLap,
  PARITY_GROUP,
  parseFrame,
  SessionAssembler,
  sha256Hex,
} from "../src/qr/protocol.js"

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

describe("QR capacity", () => {
  it("picks a version that fits a typical terminal", () => {
    expect(versionForTerminal({ columns: 80, rows: 24 })).toBeGreaterThanOrEqual(5)
    expect(recommendChunkSize({ columns: 80, rows: 24 }, "M")).toBeGreaterThan(40)
  })
})
