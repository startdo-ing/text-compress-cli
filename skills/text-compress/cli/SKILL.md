---
name: cli
description: >
  text-compress CLI: auto-detect compress vs decompress from input path or -t
  text, -e 64/85 encoding, -p password, -s split parts (or --no-split / -s 0), -o output, --compress
  and --decompress force flags. No compress/decompress subcommands in v2.
metadata:
  type: sub-skill
  library: text-compress
  library_version: '2.0.2'
sources:
  - startdo-ing/text-compress-cli:README.md
  - startdo-ing/text-compress-cli:src/cli/main.ts
  - startdo-ing/text-compress-cli:src/cli/args.ts
  - startdo-ing/text-compress-cli:src/cli/detect.ts
---

# text-compress — CLI

This skill builds on text-compress/core. Read it first for encoding, pipeline,
and v1→v2 migration context.

## Setup

```bash
npm install -g text-compress
# or without installing:
npx text-compress ./notes.md
```

Local development:

```bash
npm run dev -- ./notes.md
```

## Core Patterns

### Auto-detect compress or decompress

Pass a path; the CLI picks the operation. Directories always compress. Files
and inline text are checked for a valid compressed payload.

```bash
text-compress ./notes.md          # compress file → notes.txt
text-compress ./notes.txt         # decompress if valid payload
text-compress ./my-project        # compress folder
text-compress -t "hello world"    # compress inline text
```

### Password protection

```bash
text-compress ./notes.md -p "my secret" -o locked.txt
text-compress ./locked.txt -p "my secret" -o notes.md
```

### Base85 encoding and split output

```bash
text-compress ./notes.md -e 85
text-compress ./large-file.txt -s 4000
text-compress ./large-file.txt --no-split   # or -s 0
text-compress ./output.7.txt      # decompress any split sibling
```

### Force mode when auto-detect is wrong

```bash
text-compress --compress ./looks-compressed.txt
text-compress --decompress ./plain.md
```

## Default output paths (when `-o` omitted)

| Operation | Default output |
| --- | --- |
| Compress file/text | `<input>.txt` |
| Compress folder | `<folder-name>.txt` |
| Decompress text | `<input>.de.txt` |
| Decompress folder | `<input>.de/` |

## Common Mistakes

### [CRITICAL] Using v1 subcommands `compress` / `decompress`

Wrong:

```bash
tc compress notes.md
tc decompress out.txt
```

Correct:

```bash
text-compress notes.md
text-compress out.txt
```

v2 has no required subcommand. Legacy `compress`/`decompress` as the first
argument still work but are deprecated.

Source: README.md — Migration from @startdoing/tc v1

### [HIGH] Omitting password on protected payload

Wrong:

```bash
text-compress ./locked.txt
```

Correct:

```bash
text-compress ./locked.txt -p "my secret"
```

Password-protected payloads error without `-p`. They are **not** silently
re-compressed.

Source: src/cli/main.ts, src/payload/tags.ts

### [HIGH] Passing a directory to decompress

Wrong:

```bash
text-compress ./restored-project/
```

Correct:

```bash
text-compress ./restored-project.txt
```

Decompress expects a compressed file path, not an output directory.

Source: src/cli/args.ts

### [MEDIUM] Mixing v1 and v2 split part files

Wrong:

```bash
# Expecting v1 raw concatenation without ;TCP2; headers
text-compress ./v1-part.1.txt
```

Correct:

```bash
# v2 parts have ;TCP2; ASCII headers; pass any sibling
text-compress ./output.7.txt
```

v2 split format is not compatible with v1.

Source: README.md — v2 split output

### [MEDIUM] Multiple input sources

Wrong:

```bash
text-compress ./a.md -t "hello"
```

Correct:

```bash
text-compress ./a.md
# or
text-compress -t "hello"
```

Only one input source allowed per invocation.

Source: src/cli/args.ts
