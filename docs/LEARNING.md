# Learning Guide — Concepts, Patterns & Keywords

This document is a **glossary and study map** for `@startdoing/tc`. Every term below appears somewhere in this repository. Use it to explore the codebase as a self-directed learning path: read a concept here, then open the linked file and trace how it is applied.

**Companion docs**

- [ARCHITECTURE.md](./ARCHITECTURE.md) — module layout, data-flow diagrams, extension guide
- [README.md](../README.md) — install, CLI usage, API reference, change logs

**How to use this guide**

1. Skim the [index](#index) to find a topic you are curious about.
2. Read the definition and *why we use it here*.
3. Open the **Where in this repo** links and read the code.
4. Follow **See also** for deeper external reading.

---

## Index

| Category | Topics |
|---|---|
| [Compression & encoding](#compression--encoding) | Brotli, Base64, Z85, UTF-8, binary wire format |
| [Data structures & formats](#data-structures--formats) | Type tag, length-prefixed entries, little-endian, archive format |
| [Design patterns](#design-patterns) | Strategy, facade, barrel export, discriminated union, staged pipeline |
| [Algorithms & traversal](#algorithms--traversal) | Depth-first walk, deterministic sort, chunk splitting |
| [Node.js & I/O](#nodejs--io) | Buffer, sync vs streaming, `zlib`, `pipeline`, temp files |
| [TypeScript](#typescript) | Union types, ESM, `type: module`, path aliases |
| [CLI design](#cli-design) | Argument parsing, auto-detection, usage strings |
| [Filesystem & security](#filesystem--security) | Zip-slip, `.gitignore`, path validation |
| [Testing & quality](#testing--quality) | Vitest, integration tests, Biome, pretest hook |
| [Publishing & CI](#publishing--ci) | npm package, `exports` field, GitHub Actions, provenance |

---

## Compression & encoding

### Brotli

**What it is:** A lossless compression algorithm (RFC 7932) developed by Google. It combines LZ77 dictionary matching, Huffman coding, and context modelling. For text and source code it typically compresses 15–25% better than gzip at similar speed.

**Why we use it:** The whole point of this tool is *smallest pasteable output*. We always use maximum quality because speed is secondary.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/compression/brotli.ts`](../src/compression/brotli.ts) | `brotliCompress()` (sync) and `createMaxQualityBrotliCompress()` (streaming) |
| [`src/payload/tags.ts`](../src/payload/tags.ts) | Brotli wraps the tagged payload before encoding |
| [`src/streaming/folder.ts`](../src/streaming/folder.ts) | Streaming Brotli stage in the folder pipeline |

**Key parameters used**

| Parameter | Value | Meaning |
|---|---|---|
| `BROTLI_PARAM_QUALITY` | 11 (`BROTLI_MAX_QUALITY`) | Best compression ratio, slowest |
| `BROTLI_PARAM_LGWIN` | max window bits | Largest LZ77 look-back window |
| `BROTLI_PARAM_SIZE_HINT` | input byte length | Helps the encoder pre-allocate buffers |

**See also:** [RFC 7932](https://www.rfc-editor.org/rfc/rfc7932)

---

### Base64

**What it is:** A standard encoding (RFC 4648) that maps every 3 bytes of binary data to 4 ASCII characters using `A–Z`, `a–z`, `0–9`, `+`, `/`, and `=` padding.

**Why we use it:** Base64 is the default output format because it is universally safe to paste into chat, email, JSON, URLs, and most editors without corruption.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/encoding/base64.ts`](../src/encoding/base64.ts) | `encodeBase64()` / `decodeBase64()` wrappers around Node's `Buffer` |
| [`src/encoding/index.ts`](../src/encoding/index.ts) | Selected when `encoding === 64` |
| [`src/types.ts`](../src/types.ts) | `Encoding = 64 | 85` — `64` means Base64 |

**See also:** [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648)

---

### Z85 (Base85)

**What it is:** A base-85 positional encoding from [ZeroMQ RFC 32](https://rfc.zeromq.org/spec/32/). Each group of 4 input bytes becomes 5 printable ASCII characters from a carefully chosen 85-character alphabet.

**Why we use it:** Z85 output is ~8% smaller than Base64. Its alphabet avoids `"`, `\`, and `` ` `` — characters that break when pasted into code blocks or JSON strings. We call this option `85` in the CLI (`-e 85`).

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/encoding/z85.ts`](../src/encoding/z85.ts) | `z85Encode()` / `z85Decode()`, padding scheme, `Z85_ALPHABET` |
| [`src/encoding/index.ts`](../src/encoding/index.ts) | Selected when `encoding === 85` |
| [`src/streaming/folder.ts`](../src/streaming/folder.ts) | Z85 path loads the full padded buffer (trade-off for correctness) |

**Padding scheme:** Z85 requires input length divisible by 4. We prefix a 1-byte pad count (`0–3`) then zero-pad the payload. See the module header in `z85.ts`.

---

### UTF-8

**What it is:** A variable-width Unicode encoding where ASCII characters use 1 byte and other characters use 2–4 bytes.

**Why we use it:** JavaScript strings are UTF-16 internally, but we convert to UTF-8 bytes before compression because that is the standard on-the-wire text encoding and Brotli compresses UTF-8 text efficiently.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/api/text.ts`](../src/api/text.ts) | `Buffer.from(text, "utf-8")` on compress; `.toString("utf-8")` on decompress |
| [`src/archive/format.ts`](../src/archive/format.ts) | File paths stored as UTF-8 bytes in the archive |

---

## Data structures & formats

### Type tag (discriminated union)

**What it is:** A single leading byte that tells the decoder what kind of data follows. After Brotli decompression the first byte is either `0x01` (text) or `0x02` (folder archive). This is a lightweight form of **discriminated union** — one container format, multiple payload types.

**Why we use it:** One encoded string can represent text *or* a folder without any external metadata file. The decompress path reads the tag and routes accordingly.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/payload/tags.ts`](../src/payload/tags.ts) | `TAG_TEXT`, `TAG_FOLDER`, `wrapPayload()`, `decompressPayload()` |
| [`src/api/text.ts`](../src/api/text.ts) | Throws if tag is not `TAG_TEXT` |
| [`src/api/folder.ts`](../src/api/folder.ts) | Expects `TAG_FOLDER` for folder unpack |

**On-the-wire layout**

```
[tag: u8][payload bytes…]
     │           └── Brotli-compressed body
     └── 0x01 = text, 0x02 = folder
```

**Analogies:** MIME type headers, protobuf field numbers, Rust enum variants.

---

### Custom archive format (length-prefixed binary)

**What it is:** Instead of ZIP or tar, we use a minimal flat binary format. Each entry is a type byte followed by length-prefixed fields (paths and file contents).

**Why we use it:** ZIP adds overhead and complexity. Our format is easy to serialize, stream to disk, and test deterministically.

**Wire format**

```
directory: [0x44] [pathLen: u32le] [path utf-8]
file:      [0x46] [pathLen: u32le] [path utf-8] [contentLen: u32le] [content]
```

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/archive/types.ts`](../src/archive/types.ts) | `ArchiveEntry`, `ENTRY_DIR` (`0x44`), `ENTRY_FILE` (`0x46`) |
| [`src/archive/format.ts`](../src/archive/format.ts) | `serializeArchive()`, `deserializeArchive()`, `writeFileEntry()` |
| [`src/archive/collect.ts`](../src/archive/collect.ts) | Builds entry list from directory walk |
| [`src/archive/unpack.ts`](../src/archive/unpack.ts) | Restores entries to disk |

---

### Little-endian u32 (`u32le`)

**What it is:** A 32-bit unsigned integer stored with the least significant byte first. Node's `writeUInt32LE` / `readUInt32LE` handle this.

**Why we use it:** Consistent, compact length fields that work on all platforms Node supports. Four bytes can represent paths and files up to ~4 GB.

**Where in this repo:** [`src/archive/format.ts`](../src/archive/format.ts) — every `pathLen` and `contentLen` field.

---

### Flat list vs tree

**What it is:** A design choice to store archive entries as a **flat pre-order list** (directories and files in walk order) rather than a nested tree structure.

**Why we use it:** A flat list is trivial to stream to a file without building an in-memory tree. Unpack recreates directory structure from path strings.

**Where in this repo:** [`src/archive/collect.ts`](../src/archive/collect.ts), [`src/streaming/folder.ts`](../src/streaming/folder.ts)

---

## Design patterns

### Strategy pattern

**What it is:** A behavioural pattern where an algorithm is selected at runtime via a parameter, without `if/else` branches scattered through the codebase.

**Why we use it:** Base64 and Z85 are interchangeable encodings. Callers pass `encoding: 64 | 85` and the facade picks the right codec.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/encoding/index.ts`](../src/encoding/index.ts) | `encodeBuffer()` / `decodeBuffer()` dispatch on `encoding` |
| [`src/types.ts`](../src/types.ts) | `Encoding` union type drives the strategy |

---

### Facade pattern

**What it is:** A simplified interface that hides subsystem complexity. Higher layers call one function instead of importing multiple low-level modules.

**Why we use it:** `encodeBuffer` / `decodeBuffer` hide Base64 and Z85 details. `compressTaggedPayload` hides tag + Brotli + encode steps.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/encoding/index.ts`](../src/encoding/index.ts) | Encoding facade |
| [`src/payload/tags.ts`](../src/payload/tags.ts) | `compressTaggedPayload()` — one call for the full compress pipeline |
| [`src/api/text.ts`](../src/api/text.ts) | `compress()` / `decompress()` — user-facing facade |

---

### Barrel export

**What it is:** A single `index.ts` file that re-exports symbols from many modules, defining the public package surface.

**Why we use it:** npm consumers import from `@startdoing/tc` without knowing internal folder structure. Internal modules (`streaming/`, `cli/`) stay private.

**Where in this repo:** [`src/index.ts`](../src/index.ts) — only file listed in `package.json` `exports`.

---

### Staged pipeline (bounded memory)

**What it is:** A multi-step data processing pattern where each stage reads from the previous stage's output and writes to the next, often via temporary files on disk.

**Why we use it:** Large folder trees may not fit in RAM. Streaming through temp files keeps peak memory at chunk-buffer size (1–3 MiB) instead of total archive size.

**Pipeline stages**

```
walk tree → temp archive.bin → stream Brotli → temp compressed.bin → stream encode → output.txt
```

**Where in this repo:** [`src/streaming/folder.ts`](../src/streaming/folder.ts)

**Contrast:** [`src/api/folder.ts`](../src/api/folder.ts) `compressFolder()` loads everything in memory — fine for small folders, simpler API.

---

### Command pattern (CLI)

**What it is:** Each CLI subcommand (`compress`, `decompress`) is a separate module with its own handler, orchestrated by a thin `main.ts`.

**Why we use it:** Keeps argument parsing, I/O, and business logic separated. Easy to add new commands later.

**Where in this repo**

| File | Role |
|---|---|
| [`src/cli/main.ts`](../src/cli/main.ts) | Entry point, routes to commands |
| [`src/cli/commands/compress.ts`](../src/cli/commands/compress.ts) | Compress command |
| [`src/cli/commands/decompress.ts`](../src/cli/commands/decompress.ts) | Decompress command |
| [`src/cli/args.ts`](../src/cli/args.ts) | Parse and resolve CLI arguments |

---

## Algorithms & traversal

### Depth-first search (DFS) directory walk

**What it is:** A tree traversal that goes as deep as possible along each branch before backtracking. We walk folders recursively, visiting every file and subdirectory.

**Why we use it:** Natural order for building a flat archive list. Same traversal in both in-memory (`collectEntries`) and streaming (`buildArchiveFile`) paths.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/fs/walk.ts`](../src/fs/walk.ts) | `walkDirectory()` — shared DFS with sorted children |
| [`src/archive/collect.ts`](../src/archive/collect.ts) | In-memory walk callbacks |
| [`src/streaming/folder.ts`](../src/streaming/folder.ts) | Streaming walk writes directly to archive file |

---

### Deterministic output (sorted children)

**What it is:** Directory entries are sorted alphabetically (`localeCompare`) before traversal so the same folder always produces the same byte sequence.

**Why we use it:** Makes tests reliable and enables byte-level comparison / deduplication of archives.

**Where in this repo:** [`src/fs/walk.ts`](../src/fs/walk.ts) line 38–40, [`src/archive/collect.ts`](../src/archive/collect.ts)

---

### String chunking / split files

**What it is:** Dividing a long encoded string into fixed-size character chunks, written to numbered part files (`output.1.txt`, `output.2.txt`, …).

**Why we use it:** Chat platforms and some editors limit paste size (~30 000–50 000 characters). Auto-split at 30 000 chars keeps each part pasteable.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/split/parts.ts`](../src/split/parts.ts) | `splitString()`, `resolveSplitChunkSize()`, `AUTO_SPLIT_CHARS` |
| [`src/split/parts.ts`](../src/split/parts.ts) | `formatSplitOutputPath()` — zero-padded indices |
| [`src/cli/commands/compress.ts`](../src/cli/commands/compress.ts) | Applies split after compression |

**Zero-padding trick:** Part numbers are padded to the width of the total part count so lexical sort equals numeric sort (`02` before `10`).

---

## Node.js & I/O

### Buffer

**What it is:** Node.js's fixed-size raw binary data type. Like `Uint8Array` but with extra helpers (`readUInt32LE`, `concat`, etc.).

**Why we use it:** Compression, encoding, and archive serialization all operate on bytes, not JavaScript strings.

**Where in this repo:** Used throughout — start with [`src/payload/tags.ts`](../src/payload/tags.ts) and [`src/archive/format.ts`](../src/archive/format.ts).

---

### Sync vs streaming I/O

**What it is:**

- **Sync:** Load entire input into memory, process, return result (`brotliCompressSync`, `readFileSync`).
- **Streaming:** Process data in chunks via Node streams (`createReadStream`, `pipeline`, transform streams).

**Why we use both:** Sync is simpler for text and small folders. Streaming is required for large folder trees.

**Where in this repo**

| Path | Style |
|---|---|
| [`src/compression/brotli.ts`](../src/compression/brotli.ts) | Both: `brotliCompress` (sync) + `createMaxQualityBrotliCompress` (stream) |
| [`src/api/text.ts`](../src/api/text.ts) | Sync |
| [`src/streaming/folder.ts`](../src/streaming/folder.ts) | Streaming pipeline |

---

### `pipeline()` (stream/promises)

**What it is:** Node.js utility that connects readable → transform → writable streams and returns a Promise that resolves when all data has flowed through.

**Why we use it:** Clean way to pipe archive bytes through Brotli compression into a temp file without manual event handling.

**Where in this repo:** [`src/streaming/folder.ts`](../src/streaming/folder.ts)

---

### Temporary files (`mkdtempSync`)

**What it is:** Creating a unique temp directory (under OS `tmpdir()`) for intermediate pipeline stages, then deleting it when done.

**Why we use it:** Stages need somewhere to write/read multi-megabyte blobs without holding them all in RAM.

**Where in this repo:** [`src/streaming/folder.ts`](../src/streaming/folder.ts) — `mkdtempSync`, `rmSync` cleanup in `finally` blocks.

---

## TypeScript

### Union type (`64 | 85`)

**What it is:** A type that accepts only specific literal values. `Encoding = 64 | 85` means only those two numbers are valid.

**Why we use it:** Compile-time safety for encoding selection. Typos like `encoding: 86` fail at build time.

**Where in this repo:** [`src/types.ts`](../src/types.ts)

---

### ESM (`"type": "module"`)

**What it is:** ECMAScript Modules — `import` / `export` syntax with `.js` extensions in import paths (TypeScript compiles `.ts` → `.js` but imports keep `.js`).

**Why we use it:** Modern Node.js default for new packages. Enables tree-shaking and matches browser module semantics.

**Where in this repo:** [`package.json`](../package.json) `"type": "module"`, all `import … from "./foo.js"` paths in `src/`.

---

### `@module` JSDoc headers

**What it is:** A documentation comment at the top of each source file describing the module's role, algorithms, and patterns.

**Why we use it:** Self-documenting codebase — each file explains *why* it exists, not just *what* it does.

**Where in this repo:** Every file under `src/` — open any `.ts` file and read the header block.

---

## CLI design

### Argument parsing (sequential scan)

**What it is:** A hand-rolled loop over `process.argv` that recognises flags (`-t`, `-o`, `-e`, `-s`) and positional paths. No third-party parser library.

**Why we use it:** The flag set is small and fixed. A general-purpose parser (yargs, commander) would add dependency weight for little gain.

**Where in this repo:** [`src/cli/args.ts`](../src/cli/args.ts) — `parseArgs()`, `resolveInputArgs()`

---

### Input auto-detection

**What it is:** When the user passes a bare path (no `-t`/`-f`/`-d`), the CLI checks `statSync` to decide if it is a file, directory, or missing.

**Why we use it:** Better UX — `tc compress ./my-project` just works without `-d`.

**Where in this repo:** [`src/cli/args.ts`](../src/cli/args.ts) `resolveInputArgs()`, [`src/cli/paths.ts`](../src/cli/paths.ts)

---

### Analytics / summary output

**What it is:** After compression, the CLI prints human-readable stats (original size, compressed size, ratio, file counts).

**Where in this repo:** [`src/cli/analytics.ts`](../src/cli/analytics.ts), [`src/cli/output.ts`](../src/cli/output.ts)

---

## Filesystem & security

### Zip-slip (path traversal attack)

**What it is:** A vulnerability where an archive contains paths like `../../etc/passwd`. A naive unpacker could write files outside the intended destination directory.

**Why we care:** Folder archives contain user-supplied paths. We must reject unsafe paths on unpack.

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/archive/format.ts`](../src/archive/format.ts) | `deserializeArchive()` rejects `..` and absolute paths |
| [`src/archive/unpack.ts`](../src/archive/unpack.ts) | Writes only under the destination root |

---

### `.gitignore` filtering

**What it is:** Applying Git's ignore rules during directory walks so `node_modules/`, `dist/`, `.env`, etc. are skipped when compressing a project folder.

**Why we use it:** Default behaviour matches developer expectations — compressing a repo should not bundle build artifacts and dependencies.

**How it works**

1. Find the git repo root (walk up until `.git` exists).
2. Load ancestor `.gitignore` files outside → inside.
3. Load each directory's `.gitignore` while descending.
4. Later rules can negate earlier ones (standard git behaviour).

**Where in this repo**

| File | What to look at |
|---|---|
| [`src/fs/gitignore.ts`](../src/fs/gitignore.ts) | `GitignoreFilter` class, `findGitRoot()` |
| [`src/fs/walk.ts`](../src/fs/walk.ts) | `useGitignore` option (default `true`) |
| [`test/gitignore.test.ts`](../test/gitignore.test.ts) | Tests for ignore behaviour |

**Dependency:** [`ignore`](https://www.npmjs.com/package/ignore) npm package — parses `.gitignore` syntax.

---

### Path validation helpers

**What it is:** Centralised functions that stat paths and throw clear, actionable error messages.

**Why we use it:** Consistent errors across CLI and library — "path is a directory" vs "path not found" vs "not a regular file".

**Where in this repo:** [`src/fs/paths.ts`](../src/fs/paths.ts) — `assertDirectory()`, `readTextFile()`

---

## Testing & quality

### Vitest

**What it is:** A fast Vite-native test runner compatible with Jest APIs (`describe`, `it`, `expect`).

**Why we use it:** Zero-config TypeScript testing, fast watch mode, modern ESM support.

**Where in this repo**

| File | What to look at |
|---|---|
| [`vitest.config.ts`](../vitest.config.ts) | Test file glob pattern |
| [`test/text-compress.test.ts`](../test/text-compress.test.ts) | Library round-trip tests |
| [`test/cli.test.ts`](../test/cli.test.ts) | CLI integration tests (spawns `dist/cli.js`) |
| [`test/gitignore.test.ts`](../test/gitignore.test.ts) | Gitignore filter tests |

---

### Pretest build hook

**What it is:** npm lifecycle script `"pretest": "npm run build"` runs automatically before `npm test`.

**Why we use it:** Tests import compiled `dist/` for CLI integration. Ensures tests always run against the latest build.

**Where in this repo:** [`package.json`](../package.json) scripts section.

---

### Biome

**What it is:** A fast linter and formatter (successor spirit to ESLint + Prettier combined).

**Why we use it:** Consistent code style, import organisation, and lint rules without multiple tools.

**Where in this repo:** [`biome.json`](../biome.json), `npm run check` runs Biome + TypeScript.

---

### Round-trip testing

**What it is:** A test pattern where you compress input, decompress output, and assert the result equals the original.

**Why we use it:** Proves the full pipeline (tag → Brotli → encode → decode → decompress → untag) is lossless.

**Where in this repo:** [`test/text-compress.test.ts`](../test/text-compress.test.ts)

---

## Publishing & CI

### npm package (`@startdoing/tc`)

**What it is:** A scoped npm package published under the `@startdoing` organisation. Consumers install with `npm install -g @startdoing/tc`.

**Key `package.json` fields**

| Field | Purpose |
|---|---|
| `"name"` | `@startdoing/tc` |
| `"bin"` | Maps `tc` command to `dist/cli.js` |
| `"exports"` | Defines the public import surface (only `.`) |
| `"files"` | Only `dist/` is published (not `src/`) |
| `"prepublishOnly"` | Builds before publish |

**Where in this repo:** [`package.json`](../package.json)

---

### Conditional exports

**What it is:** The `exports` field in `package.json` controls exactly what importers can `import` from your package.

**Why we use it:** Prevents consumers from reaching internal modules. Only `src/index.ts` (compiled to `dist/index.js`) is public.

**Where in this repo:** [`package.json`](../package.json) `exports` block.

---

### GitHub Actions CI/CD

**What it is:** Automated workflow that runs on every push to `main`: install → test → publish to npm.

**Why we use it:** Every merge to main becomes a tested, published release without manual steps.

**Where in this repo:** [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)

**Notable details**

- `npm ci` — reproducible installs from lockfile
- `npm publish --provenance --access public` — supply-chain attestation
- `NODE_AUTH_TOKEN` from GitHub secrets

---

### `tsx` (development runner)

**What it is:** A TypeScript execution tool that runs `.ts` files directly without a separate build step.

**Why we use it:** `npm run dev -- compress -t "hello"` for fast CLI iteration during development.

**Where in this repo:** [`package.json`](../package.json) `"dev": "tsx src/cli.ts"`

---

## Suggested learning paths

### Path A — "I want to understand compression"

1. [Brotli](#brotli) → [`src/compression/brotli.ts`](../src/compression/brotli.ts)
2. [Type tag](#type-tag-discriminated-union) → [`src/payload/tags.ts`](../src/payload/tags.ts)
3. [Base64](#base64) / [Z85](#z85-base85) → [`src/encoding/`](../src/encoding/)
4. [Round-trip testing](#round-trip-testing) → [`test/text-compress.test.ts`](../test/text-compress.test.ts)

### Path B — "I want to understand folder archives"

1. [DFS walk](#depth-first-search-dfs-directory-walk) → [`src/fs/walk.ts`](../src/fs/walk.ts)
2. [Archive format](#custom-archive-format-length-prefixed-binary) → [`src/archive/format.ts`](../src/archive/format.ts)
3. [Staged pipeline](#staged-pipeline-bounded-memory) → [`src/streaming/folder.ts`](../src/streaming/folder.ts)
4. [`.gitignore`](#gitignore-filtering) → [`src/fs/gitignore.ts`](../src/fs/gitignore.ts)

### Path C — "I want to understand CLI tools"

1. [Argument parsing](#argument-parsing-sequential-scan) → [`src/cli/args.ts`](../src/cli/args.ts)
2. [Command pattern](#command-pattern-cli) → [`src/cli/commands/`](../src/cli/commands/)
3. [Split files](#string-chunking--split-files) → [`src/split/parts.ts`](../src/split/parts.ts)
4. [CLI integration tests](#vitest) → [`test/cli.test.ts`](../test/cli.test.ts)

### Path D — "I want to understand package publishing"

1. [Barrel export](#barrel-export) → [`src/index.ts`](../src/index.ts)
2. [Conditional exports](#conditional-exports) → [`package.json`](../package.json)
3. [GitHub Actions](#github-actions-cicd) → [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)
4. [Pretest hook](#pretest-build-hook) → [`package.json`](../package.json)

---

## Glossary (quick lookup)

| Term | One-line definition |
|---|---|
| **Archive entry** | One directory or file record in the custom binary format |
| **Auto-split** | Automatic division of output at 30 000 characters |
| **Barrel export** | Single `index.ts` re-exporting the public API |
| **Brotli** | Modern lossless compressor, max quality in this repo |
| **Buffer** | Node.js raw binary data type |
| **Chunk** | Fixed-size piece of data processed in streaming I/O |
| **DFS** | Depth-first directory tree traversal |
| **Discriminated union** | Variant type identified by a tag byte |
| **ESM** | ECMAScript Modules (`import`/`export`) |
| **Facade** | Simplified wrapper hiding subsystem details |
| **Length-prefixed** | Format where each field is preceded by its byte length |
| **Little-endian** | Least significant byte stored first in multi-byte integers |
| **Pipeline** | Chained stream processing stages |
| **Provenance** | npm attestation linking package to source repo |
| **Round-trip** | Compress then decompress; result must equal input |
| **Strategy pattern** | Runtime algorithm selection via a parameter |
| **Tag byte** | Leading byte identifying payload type after decompression |
| **Temp file staging** | Write intermediate results to disk to bound memory |
| **UTF-8** | Standard Unicode byte encoding for text |
| **Wire format** | Exact byte layout on the network / in a file |
| **Zip-slip** | Path traversal attack via malicious archive paths |
| **Z85** | ZeroMQ base-85 encoding, ~8% smaller than Base64 |

---

*This guide grows with the repository. When you add a feature, add its concepts here.*
