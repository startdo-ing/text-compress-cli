---
name: library
description: >
  text-compress library API: compress, decompress, compressFolder,
  decompressToPath, decompressPayload, split helpers. Encoding 64|85, optional
  password. TAG_TEXT vs TAG_FOLDER routing. Import from "text-compress".
metadata:
  type: sub-skill
  library: text-compress
  library_version: '2.0.2'
sources:
  - startdo-ing/text-compress-cli:README.md
  - startdo-ing/text-compress-cli:src/index.ts
  - startdo-ing/text-compress-cli:src/api/text.ts
  - startdo-ing/text-compress-cli:src/api/folder.ts
---

# text-compress — Library API

This skill builds on text-compress/core. Read it first for encoding and pipeline
context.

## Setup

```ts
import {
  compress,
  decompress,
  compressFolder,
  decompressToPath,
} from "text-compress";
```

Requires Node.js >= 18. Package name is `"text-compress"` (not `@startdoing/tc`).

## Core Patterns

### Compress and decompress text

```ts
const encoded = compress("hello world");
const restored = decompress(encoded);

// Z85 encoding (~8% smaller)
const z85 = compress("hello world", 85);
const fromZ85 = decompress(z85, 85);
```

### Password-protected text

```ts
const locked = compress("hello world", 64, "my secret");
const unlocked = decompress(locked, 64, "my secret");
```

### Folder archives

```ts
const { encoded, fileCount, dirCount, originalBytes } =
  compressFolder("./my-project");

decompressToPath(encoded, "./restored-project");
```

### Low-level payload access

```ts
import { decompressPayload, TAG_TEXT, TAG_FOLDER } from "text-compress";

const { tag, data } = decompressPayload(encoded, 64, password);
if (tag === TAG_TEXT) {
  const text = data.toString("utf-8");
}
```

## API Reference

| Function | Description |
| --- | --- |
| `compress(text, encoding?, password?)` | UTF-8 text → encoded string (`64` or `85`) |
| `decompress(encoded, encoding?, password?)` | Encoded text payload → string |
| `compressFolder(dirPath, encoding?, password?)` | Folder → `{ encoded, fileCount, ... }` |
| `decompressToPath(encoded, destDir, encoding?, password?)` | Unpack folder archive |
| `decompressPayload(encoded, encoding?, password?)` | Low-level `{ tag, data }` |

## Common Mistakes

### [CRITICAL] Using v1 package import

Wrong:

```ts
import { compress } from "@startdoing/tc";
```

Correct:

```ts
import { compress, decompress } from "text-compress";
```

v1 remains frozen at 1.0.4; v2 is a separate npm package.

Source: README.md — Migration

### [HIGH] Calling decompress on a folder payload

Wrong:

```ts
const encoded = compressFolder("./project").encoded;
const text = decompress(encoded); // throws
```

Correct:

```ts
decompressToPath(encoded, "./restored");
```

Text and folder payloads share encoding but differ by tag byte after Brotli
decompression. `decompress()` throws if the tag is `TAG_FOLDER`.

Source: src/api/text.ts

### [HIGH] Calling decompressToPath on text payload

Wrong:

```ts
const encoded = compress("hello");
decompressToPath(encoded, "./out"); // throws
```

Correct:

```ts
const text = decompress(encoded);
```

Source: src/api/folder.ts

### [MEDIUM] Mismatched encoding on round-trip

Wrong:

```ts
const encoded = compress("hello", 85);
const text = decompress(encoded, 64); // fails or garbage
```

Correct:

```ts
const encoded = compress("hello", 85);
const text = decompress(encoded, 85);
```

Source: src/encoding/index.ts

### [MEDIUM] compressFolder loads entire tree into memory

Wrong:

```ts
// For very large folders in production scripts
compressFolder("/huge-monorepo");
```

Correct:

```bash
# CLI uses streaming pipeline for folders (bounded memory)
text-compress ./huge-monorepo
```

The library `compressFolder()` walks and serializes in memory. The CLI
streaming path is internal and not exported.

Source: docs/ARCHITECTURE.md — Two folder compression paths
