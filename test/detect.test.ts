import { describe, expect, it } from "vitest"
import { compress } from "../src/api/text.js"
import { detectCompressedPayload } from "../src/cli/detect.js"

describe("detectCompressedPayload", () => {
  it("detects valid compressed text", () => {
    const encoded = compress("detect me", 64)
    expect(detectCompressedPayload(encoded, undefined)).toBe("compressed")
  })

  it("treats plain text as not compressed", () => {
    expect(detectCompressedPayload("# hello\nworld", undefined)).toBe("not-compressed")
  })

  it("requires a password for encrypted payloads", () => {
    const encoded = compress("secret", 64, "pw")
    expect(detectCompressedPayload(encoded, undefined)).toBe("password-required")
    expect(detectCompressedPayload(encoded, 64, "pw")).toBe("compressed")
  })
})
