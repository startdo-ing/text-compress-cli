# @startdoing/tc

Brotli-compress text or entire folder trees into a single base64 or Z85 base85 string — ideal for pasting compressed payloads into chat, email, or code.

## Features

- **Max-quality Brotli** compression via Node.js `zlib`
- **Base64 (default)** — safe to paste anywhere (`A-Za-z0-9+/=`)
- **Z85 base85** — ~8% smaller output; uses punctuation safe for code blocks
- **Folder archives** — pack a whole directory tree (structure + file contents) into one string
- **Password protection** — optionally encrypt compressed output with AES-256-GCM (`-p` / `--password`)
- **CLI + library** — use from the terminal or import in your own scripts
- **Learning docs** — glossary of concepts, patterns, and keywords with file references ([docs/LEARNING.md](docs/LEARNING.md))

## Install

```bash
npm install -g @startdoing/tc
```

Or clone and build locally:

```bash
git clone <repo-url>
cd text-compress
npm install
npm run build
```

## CLI

```bash
# Compress text
tc compress -t "hello world" -o output.txt

# Compress a file (path auto-detected)
tc compress notes.md

# Compress a folder (path auto-detected)
tc compress ./my-project

# Use base85 encoding (~8% smaller)
tc compress notes.md -e 85

# Password-protect the output (required to decompress)
tc compress notes.md -p "my secret"
tc compress ./my-project -p "my secret"

# Decompress (auto-detects text vs folder)
tc decompress output.txt

# Decompress password-protected output
tc decompress output.txt -p "my secret"
```

During development:

```bash
npm run dev -- compress -t "hello"
```

## Library

```ts
import {
  compress,
  decompress,
  compressFolder,
  decompressToPath,
} from "@startdoing/tc";

// Text
const encoded = compress("hello world");          // base64 by default
const restored = decompress(encoded);

// Password-protected text
const locked = compress("hello world", 64, "my secret");
const unlocked = decompress(locked, 64, "my secret");

// Folder
const { encoded: folderBlob } = compressFolder("./my-project");
decompressToPath(folderBlob, "./restored-project");

// Password-protected folder
const { encoded: lockedFolder } = compressFolder("./my-project", 64, "my secret");
decompressToPath(lockedFolder, "./restored-project", 64, "my secret");
```

### API

| Function | Description |
|---|---|
| `compress(text, encoding?, password?)` | Compress UTF-8 text → encoded string (`64` or `85`) |
| `decompress(encoded, encoding?, password?)` | Decompress text payload → string |
| `compressFolder(dirPath, encoding?, password?)` | Pack folder → `{ encoded, fileCount, dirCount, ... }` |
| `decompressToPath(encoded, destDir, encoding?, password?)` | Unpack folder archive to disk |
| `decompressPayload(encoded, encoding?, password?)` | Low-level: returns `{ tag, data }` buffer |

## Encoding options

| Value | Format | When to use |
|---|---|---|
| `64` (default) | Standard base64 | Paste anywhere — chat, email, JSON, etc. |
| `85` | Z85 base85 | Slightly smaller; paste in contexts that preserve punctuation verbatim |

Decompress must use the **same encoding** as compress.

## Password protection

Pass `-p` / `--password` on **compress** to encrypt the Brotli-compressed bytes with AES-256-GCM before encoding. The same password is required on **decompress**.

- Omitting `-p` produces unencrypted output compatible with earlier versions.
- Password-protected payloads cannot be decompressed without the correct password.
- Works for text, files, and folder archives (including split output).

```bash
tc compress notes.md -p "my secret" -o locked.txt
tc decompress locked.txt -p "my secret" -o notes.md
```

## Development

```bash
npm install
npm test          # run tests
npm run build     # compile to dist/
npm run test:watch
```

## Architecture

For a guided tour of the codebase — module layout, data-flow diagrams, algorithms, and design patterns — see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

For a learning-oriented glossary of every concept, pattern, and keyword used in this repo (with file references and study paths), see **[docs/LEARNING.md](docs/LEARNING.md)**.

## Change logs

How this repo started and grew — each version builds on the last.

### v1.0.4 — Password-protected compression

**Date:** 2026-07-08

- Added `-p` / `--password` CLI flag to encrypt compressed output with AES-256-GCM
- Optional `password` parameter on library functions (`compress`, `decompress`, `compressFolder`, `decompressToPath`, `decompressPayload`)
- Unencrypted payloads remain backward compatible with v1.0.3 and earlier

### v1.0.3 — Learning guide and formatting cleanup

**Date:** 2026-07-07

- Added `docs/LEARNING.md` — glossary of compression, encoding, design patterns, Node.js, TypeScript, CLI, security, testing, and CI concepts with file references and study paths
- Added **Change logs** section to README documenting version history from v1.0.0 onward
- Linked learning guide from README and `docs/ARCHITECTURE.md`
- Switched Biome indent style from tabs to spaces (formatting only — no behaviour changes)
- Added `bun.lock` for Bun package manager compatibility

### v1.0.2 — Gitignore-aware folder compression

**Date:** 2026-07-06

- Folder walks now respect `.gitignore` rules by default (`node_modules/`, `dist/`, etc. are skipped)
- New `src/fs/gitignore.ts` — loads ancestor and per-directory ignore rules, matching git behaviour
- New `src/fs/walk.ts` — shared depth-first walker used by both in-memory and streaming paths
- Tests added in `test/gitignore.test.ts`

### v1.0.1 — Modular architecture & npm publishing

**Date:** 2026-07-06

- **Major refactor:** monolithic `src/index.ts` and `src/cli.ts` split into domain modules (`encoding/`, `compression/`, `archive/`, `payload/`, `api/`, `cli/`, `streaming/`, `split/`, `fs/`)
- Added `docs/ARCHITECTURE.md` — module layout, data-flow diagrams, design patterns
- Folder archive support with custom binary format (length-prefixed entries)
- Streaming folder compression pipeline for bounded memory on large trees
- Split-file output for chat paste limits (auto-split at 30 000 characters)
- Z85 base85 encoding option (`-e 85`, ~8% smaller than Base64)
- CLI improvements: path auto-detection (file vs folder), analytics summary, smarter error messages
- npm publish workflow (`.github/workflows/publish.yml`) — test and publish on push to `main`
- Added Biome for linting/formatting (`biome.json`, `npm run check`)
- Upgraded TypeScript and Vitest; added CLI integration tests (`test/cli.test.ts`)
- Fixed CI: `pretest` hook builds before running tests

### v1.0.0 — Initial release

**Date:** 2026-07-06

- Project born as `@startdoing/tc` — Brotli-compress text to a pasteable Base64 string
- Core pipeline: UTF-8 text → type tag → Brotli (max quality) → Base64
- CLI (`tc compress` / `tc decompress`) and library API (`compress` / `decompress`)
- Folder compression and decompression in a single-file codebase (`src/index.ts`, `src/cli.ts`, `src/streaming.ts`)
- Vitest test suite with round-trip tests (`test/text-compress.test.ts`)
- GitHub Actions workflow scaffold (`.github/workflows/publish.yml`)
- MIT license

## License

MIT
