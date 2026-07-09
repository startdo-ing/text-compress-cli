# text-compress

Brotli-compress text or entire folder trees into pasteable base64 or Z85 strings — ideal for chat, email, or code.

**v2** ships as [`text-compress`](https://www.npmjs.com/package/text-compress). The original CLI [`@startdoing/tc`](https://www.npmjs.com/package/@startdoing/tc) stays frozen at **v1.0.4**.

## Features

- **Auto-detect** — pass a path; plain files compress, valid payloads decompress (no subcommand)
- **Max-quality Brotli** via Node.js `zlib`
- **Base64 (default)** — paste-safe (`A-Za-z0-9+/=`)
- **Z85 base85** — ~8% smaller; punctuation-safe for code blocks
- **Folder archives** — pack a directory tree into one string
- **Password protection** — AES-256-GCM (`-p` / `--password`)
- **v2 split parts** — self-describing parts; shuffled names, merged files, any sibling as entry
- **CLI + library** — terminal or `import from "text-compress"`
- **Agent skills** — versioned [TanStack Intent](https://tanstack.com/intent/latest/docs/overview) skills ship with the package for AI coding agents

## Install

```bash
npm install -g text-compress
```

If you use an AI coding agent, run `npx @tanstack/intent@latest install` in your
project to load versioned skills shipped with this package.

Or run without installing:

```bash
npx text-compress ./notes.md
```

Local development:

```bash
git clone <repo-url>
cd text-compress
git checkout v2
npm install
npm run build
```

## CLI

No `compress` / `decompress` subcommand — the CLI picks the operation from the input.

```bash
# Compress a file
text-compress ./notes.md

# Compress with password
text-compress ./notes.md -p "hello-world"

# Decompress (auto-detected from valid compressed output)
text-compress ./notes.txt -p "hello-world"

# Compress a folder
text-compress ./my-project

# Base85 encoding (~8% smaller)
text-compress ./notes.md -e 85

# Split large output
text-compress ./large-file.txt -s 4000

# Inline text
text-compress -t "hello world" -o output.txt

# Force mode when auto-detect is wrong
text-compress --compress ./looks-compressed.txt
text-compress --decompress ./plain.md   # errors if not valid payload

# Split set — pass any sibling
text-compress ./output.7.txt
```

During development:

```bash
npm run dev -- ./notes.md
npm run dev -- ./notes.txt -p "secret"
```

### Defaults

| | Output when `-o` omitted |
|--|--|
| Compress file/text | `<input>.txt` |
| Compress folder | `<folder-name>.txt` |
| Decompress text | `<input>.de.txt` |
| Decompress folder | `<input>.de/` |

## Library

```ts
import {
  compress,
  decompress,
  compressFolder,
  decompressToPath,
} from "text-compress";

const encoded = compress("hello world");
const restored = decompress(encoded);

const locked = compress("hello world", 64, "my secret");
const unlocked = decompress(locked, 64, "my secret");

const { encoded: folderBlob } = compressFolder("./my-project");
decompressToPath(folderBlob, "./restored-project");
```

| Function | Description |
|---|---|
| `compress(text, encoding?, password?)` | UTF-8 text → encoded string (`64` or `85`) |
| `decompress(encoded, encoding?, password?)` | Encoded text payload → string |
| `compressFolder(dirPath, encoding?, password?)` | Folder → `{ encoded, fileCount, ... }` |
| `decompressToPath(encoded, destDir, encoding?, password?)` | Unpack folder archive |
| `decompressPayload(encoded, encoding?, password?)` | Low-level `{ tag, data }` |

## Encoding

| Value | Format | Use when |
|---|---|---|
| `64` (default) | Base64 | Paste anywhere |
| `85` | Z85 | Slightly smaller; paste in code blocks |

Use the same encoding for compress and decompress. When `-e` is omitted on decompress, the CLI tries both.

## Password protection

```bash
text-compress ./notes.md -p "my secret" -o locked.txt
text-compress ./locked.txt -p "my secret" -o notes.md
```

Password-protected payloads error without `-p` (they are **not** silently re-compressed).

## v2 split output

Large outputs split into numbered files (`output.1.txt`, `output.02.txt`, …). Each part embeds order in a `TCP\x02` header.

On decompress:

- Pass **any** sibling file
- Discovery uses the basename **prefix** (before the first `.`)
- Extension ignored; invalid siblings skipped
- Parts can be shuffled or merged into fewer files

**Not compatible** with v1 split format (raw concatenation without headers).

## Migration from @startdoing/tc v1

| v1 (`@startdoing/tc@1.0.4`) | v2 (`text-compress`) |
|---|---|
| `tc compress notes.md` | `text-compress notes.md` |
| `tc decompress out.txt` | `text-compress out.txt` |
| `import from "@startdoing/tc"` | `import from "text-compress"` |
| Raw split parts | Headered split parts |

## Development

```bash
npm install
npm test
npm run build
npm run check
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/LEARNING.md](docs/LEARNING.md).

## Changelog

### v2.0.2 — `text-compress` (2026-07-09)

- Ship [TanStack Intent](https://tanstack.com/intent/latest/docs/overview) agent skills (`core`, `cli`, `library`) inside the npm package
- Add `check-skills` CI workflow and `npm run validate:skills`

### v2.0.1 — `text-compress` (2026-07-08)

- Republish as **`text-compress@2.0.1`** (npm name finalized after `txtc` rejection)
- Normalized `bin` path for npm publish

### v2.0.0 — `text-compress` (2026-07-08)

- New npm package **`text-compress`** (v1 remains `@startdoing/tc@1.0.4`)
- Auto-detect compress vs decompress from input
- Shorter CLI: `text-compress ./file.md` (no subcommand)
- Self-describing split format (`TCP\x02` headers)
- Prefix-based split discovery; skip invalid siblings
- Force flags: `--compress` / `--decompress`

### v1.x

See git tag / branch `main` and [@startdoing/tc on npm](https://www.npmjs.com/package/@startdoing/tc).

## License

MIT
