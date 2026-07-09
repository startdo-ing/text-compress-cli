---
name: core
description: >
  text-compress core concepts: Brotli-compress text or folders to pasteable
  Base64 or Z85 strings. CLI auto-detect (compress vs decompress), library
  API (compress, decompress, compressFolder, decompressToPath), encoding 64/85,
  password protection, v2 split parts. Entry point for all text-compress skills.
metadata:
  type: core
  library: text-compress
  library_version: '2.0.2'
sources:
  - startdo-ing/text-compress-cli:README.md
  - startdo-ing/text-compress-cli:docs/ARCHITECTURE.md
  - startdo-ing/text-compress-cli:src/index.ts
---

# text-compress — Core Concepts

`text-compress` turns UTF-8 text or entire folder trees into a single pasteable
string (Base64 or Z85), and back again. Use the CLI for terminal workflows or
import from `"text-compress"` in Node.js/TypeScript.

**Package:** npm package `text-compress` (v2). Legacy v1 is `@startdoing/tc@1.0.4`
— do not mix APIs or split formats between versions.

## Pipeline

```
Input → type tag → Brotli (max quality) → Base64 or Z85 → pasteable string
```

Folder archives use a custom binary format before compression. Large outputs can
be split into numbered part files for chat paste limits.

## Sub-Skills

| Need to... | Read |
| --- | --- |
| Run compress/decompress from the terminal | text-compress/cli/SKILL.md |
| Call compress/decompress from TypeScript | text-compress/library/SKILL.md |

## Quick Decision Tree

- Terminal one-liner, auto-detect mode? → text-compress/cli
- Programmatic use in Node/TS? → text-compress/library
- Password-protected payload? → pass `-p` / `password` on both compress and decompress
- Large output for chat paste limits? → use `-s` split (CLI) or split helpers (library)
- Migrating from `@startdoing/tc` v1? → new package name, no subcommands, new split format

## Encoding

| Value | Format | When |
| --- | --- | --- |
| `64` (default) | Base64 | Paste anywhere |
| `85` | Z85 (ZeroMQ RFC 32) | ~8% smaller; punctuation-safe in code blocks |

Use the same encoding for compress and decompress. When `-e` is omitted on
decompress, the CLI tries both.

## Version

Targets `text-compress` v2.0.2.
