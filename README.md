# @startdoing/tc

Brotli-compress text or entire folder trees into a single base64 or Z85 base85 string — ideal for pasting compressed payloads into chat, email, or code.

## Features

- **Max-quality Brotli** compression via Node.js `zlib`
- **Base64 (default)** — safe to paste anywhere (`A-Za-z0-9+/=`)
- **Z85 base85** — ~8% smaller output; uses punctuation safe for code blocks
- **Folder archives** — pack a whole directory tree (structure + file contents) into one string
- **CLI + library** — use from the terminal or import in your own scripts

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

# Decompress (auto-detects text vs folder)
tc decompress output.txt
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

// Folder
const { encoded: folderBlob } = compressFolder("./my-project");
decompressToPath(folderBlob, "./restored-project");
```

### API

| Function | Description |
|---|---|
| `compress(text, encoding?)` | Compress UTF-8 text → encoded string (`64` or `85`) |
| `decompress(encoded, encoding?)` | Decompress text payload → string |
| `compressFolder(dirPath, encoding?)` | Pack folder → `{ encoded, fileCount, dirCount, ... }` |
| `decompressToPath(encoded, destDir, encoding?)` | Unpack folder archive to disk |
| `decompressPayload(encoded, encoding?)` | Low-level: returns `{ tag, data }` buffer |

## Encoding options

| Value | Format | When to use |
|---|---|---|
| `64` (default) | Standard base64 | Paste anywhere — chat, email, JSON, etc. |
| `85` | Z85 base85 | Slightly smaller; paste in contexts that preserve punctuation verbatim |

Decompress must use the **same encoding** as compress.

## Development

```bash
npm install
npm test          # run tests
npm run build     # compile to dist/
npm run test:watch
```

## Architecture

For a guided tour of the codebase — module layout, data-flow diagrams, algorithms, and design patterns — see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## License

MIT
