#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compress,
  decompressPayload,
  formatSplitOutputPath,
  readSplitInput,
  splitString,
  TAG_FOLDER,
  TAG_TEXT,
  unpackDirectory,
  type Encoding,
} from "./index.js";
import { compressFolderToPath } from "./streaming.js";

interface Args {
  text?: string;
  file?: string;
  dir?: string;
  output?: string;
  encoding?: string;
  split?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-t" || arg === "--text") {
      args.text = argv[++i];
    } else if (arg === "-f" || arg === "--file") {
      args.file = argv[++i];
    } else if (arg === "-d" || arg === "--dir") {
      args.dir = argv[++i];
    } else if (arg === "-o" || arg === "--output") {
      args.output = argv[++i];
    } else if (arg === "-e" || arg === "--encoding") {
      args.encoding = argv[++i];
    } else if (arg === "-s" || arg === "--split") {
      const value = argv[++i];
      const split = Number(value);
      if (!value || !Number.isInteger(split) || split < 1) {
        throw new Error(`Invalid -s/--split "${value}". Use a positive integer character count.`);
      }
      args.split = split;
    } else if (!arg.startsWith("-") && args.text === undefined) {
      args.text = arg;
    }
  }
  return args;
}

function readInput(args: Args): string {
  if (args.file) return readFileSync(args.file, "utf-8");
  if (args.text !== undefined) return args.text;
  throw new Error("No input provided. Use -t <text>, -f <file>, or -d <folder>.");
}

function resolveEncoding(args: Args): Encoding {
  if (!args.encoding) return 64;
  if (args.encoding === "64") return 64;
  if (args.encoding === "85") return 85;
  throw new Error(`Invalid -e/--encoding "${args.encoding}". Use 64 or 85.`);
}

function resolveOutputPath(args: Args, fallbackName: string, suffix: string): string {
  if (args.output) return args.output;

  const inputPath = args.dir ?? args.file;
  const defaultPath = inputPath
    ? inputPath.replace(/\.[^/.]+$/, "").replace(/[/\\]+$/, "") + suffix
    : fallbackName;

  if (inputPath && resolve(defaultPath) === resolve(inputPath)) {
    throw new Error(
      `Default output path "${defaultPath}" would overwrite the input. Specify -o <output path> explicitly.`,
    );
  }

  return defaultPath;
}

function printAnalytics(stats: Record<string, string | number>) {
  console.log("\n--- Analytics ---");
  for (const [key, value] of Object.entries(stats)) {
    console.log(`${key}: ${value}`);
  }
}

function writeCompressedOutput(encoded: string, outputPath: string, split?: number): string[] {
  if (split === undefined) {
    writeFileSync(outputPath, encoded, "utf-8");
    return [outputPath];
  }

  const chunks = splitString(encoded, split);
  return chunks.map((chunk, index) => {
    const partPath = formatSplitOutputPath(outputPath, index + 1, chunks.length);
    writeFileSync(partPath, chunk, "utf-8");
    return partPath;
  });
}

async function runCompress(args: Args) {
  const encoding = resolveEncoding(args);

  if (args.dir) {
    const outputPath = resolveOutputPath(args, "compressed.txt", ".txt");
    const start = process.hrtime.bigint();
    const {
      fileCount,
      dirCount,
      originalBytes,
      archiveBytes,
      compressedBytes,
      outputPaths,
    } = await compressFolderToPath(args.dir, outputPath, encoding, args.split);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const ratio = originalBytes === 0 ? 0 : compressedBytes / originalBytes;

    console.log(
      args.split === undefined
        ? `Compressed folder written to ${outputPaths[0]}`
        : `Compressed folder written to ${outputPaths.length} files:\n  ${outputPaths.join("\n  ")}`,
    );
    printAnalytics({
      Encoding: `base${encoding}`,
      Files: fileCount,
      Directories: dirCount,
      "Original size (bytes)": originalBytes,
      "Archive size before compression (bytes)": archiveBytes,
      [`Compressed size (bytes, base${encoding})`]: compressedBytes,
      ...(args.split !== undefined
        ? { "Split size (chars)": args.split, "Output parts": outputPaths.length }
        : {}),
      "Size ratio (compressed/original)": ratio.toFixed(3),
      "Space saved": `${((1 - ratio) * 100).toFixed(1)}%`,
      "Time taken (ms)": elapsedMs.toFixed(3),
    });
    return;
  }

  const outputPath = resolveOutputPath(args, "compressed.txt", ".txt");
  const input = readInput(args);
  const inputBytes = Buffer.byteLength(input, "utf-8");

  const start = process.hrtime.bigint();
  const result = compress(input, encoding);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  const outputPaths = writeCompressedOutput(result, outputPath, args.split);
  const outputBytes = Buffer.byteLength(result, "utf-8");
  const ratio = inputBytes === 0 ? 0 : outputBytes / inputBytes;

  console.log(
    args.split === undefined
      ? `Compressed output written to ${outputPath}`
      : `Compressed output written to ${outputPaths.length} files:\n  ${outputPaths.join("\n  ")}`,
  );
  printAnalytics({
    Encoding: `base${encoding}`,
    "Original size (bytes)": inputBytes,
    [`Compressed size (bytes, base${encoding})`]: outputBytes,
    ...(args.split !== undefined
      ? { "Split size (chars)": args.split, "Output parts": outputPaths.length }
      : {}),
    "Size ratio (compressed/original)": ratio.toFixed(3),
    "Space saved": `${((1 - ratio) * 100).toFixed(1)}%`,
    "Time taken (ms)": elapsedMs.toFixed(3),
  });
}

function readCompressedInput(args: Args): { content: string; inputBytes: number; partPaths?: string[] } {
  if (args.file) {
    const { content, partPaths } = readSplitInput(args.file);
    return {
      content,
      inputBytes: Buffer.byteLength(content, "utf-8"),
      partPaths: partPaths.length > 1 ? partPaths : undefined,
    };
  }

  const content = readInput(args);
  return { content, inputBytes: Buffer.byteLength(content, "utf-8") };
}

function runDecompress(args: Args) {
  const encoding = resolveEncoding(args);
  const { content: input, inputBytes, partPaths } = readCompressedInput(args);

  const start = process.hrtime.bigint();
  const { tag, data } = decompressPayload(input.trim(), encoding);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (tag === TAG_FOLDER) {
    const outputPath = resolveOutputPath(args, "decompressed.de", ".de");
    const { files, dirs, bytes } = unpackDirectory(data, outputPath);

    console.log(`Decompressed folder recreated at ${outputPath}`);
    printAnalytics({
      Encoding: `base${encoding}`,
      [`Compressed size (bytes, base${encoding})`]: inputBytes,
      ...(partPaths ? { "Input parts": partPaths.length } : {}),
      "Files restored": files,
      "Directories restored": dirs,
      "Decompressed size (bytes)": bytes,
      "Time taken (ms)": elapsedMs.toFixed(3),
    });
    return;
  }

  if (tag !== TAG_TEXT) {
    throw new Error(`Corrupt or unrecognized payload (tag 0x${tag.toString(16)}).`);
  }

  const outputPath = resolveOutputPath(args, "decompressed.de.txt", ".de.txt");
  const result = data.toString("utf-8");
  writeFileSync(outputPath, result, "utf-8");
  const outputBytes = Buffer.byteLength(result, "utf-8");
  const ratio = inputBytes === 0 ? 0 : outputBytes / inputBytes;

  console.log(`Decompressed output written to ${outputPath}`);
  printAnalytics({
    Encoding: `base${encoding}`,
    [`Compressed size (bytes, base${encoding})`]: inputBytes,
    ...(partPaths ? { "Input parts": partPaths.length } : {}),
    "Decompressed size (bytes)": outputBytes,
    "Expansion ratio (decompressed/compressed)": ratio.toFixed(3),
    "Time taken (ms)": elapsedMs.toFixed(3),
  });
}

function printUsage() {
  console.log(`
text-compress - brotli (max quality) compress/decompress with base64 or base85 output

Usage:
  text-compress <command> [options]

Commands:
  compress      Brotli-compress the input (max quality), encode it, and
                write it to a file. With -d, packs a whole folder (structure
                + file contents, no permissions/timestamps) into one file.
  decompress    Decode the input, brotli-decompress it, and write the
                result. Automatically detects whether the original input
                was text or a packed folder and recreates it accordingly.
                With -f, also auto-detects split parts (e.g. output.01.txt)
                and concatenates them before decompressing.
                Must use the same -e/--encoding as the compress step.

Options:
  -t, --text <string>     Input given directly as a string
  -f, --file <path>       Input read from a file
  -d, --dir <path>        Input read from a folder (compress only) — packs
                           the whole folder tree into a single output file
  -o, --output <path>     Output path (optional, see defaults below)
  -s, --split <chars>     Split compressed output into multiple files, each
                           at most this many characters (compress only).
                           Parts are named by inserting .NNN before the
                           extension, e.g. output.001.txt, output.002.txt
  -e, --encoding <64|85>  Text encoding for the compressed output (default: 64)
                             64: standard base64 [A-Za-z0-9+/=] — safe to
                                 paste literally anywhere (chat, email, etc.)
                             85: Z85 base85 — ~8% smaller, but uses extra
                                 punctuation; only paste it somewhere that
                                 preserves text verbatim (e.g. a code block)
  -h, --help               Show this usage guide

Defaults:
  If -o is omitted, the output path is derived from the input's name:
    compress (file/text): <input>.txt
    compress (folder):    <folder-name>.txt
    decompress (text):    <input>.de.txt
    decompress (folder):  <input>.de   (recreated as a directory)

Examples:
  text-compress compress -t "some text" -o output.txt
  text-compress compress -f notes.md
  text-compress compress -f notes.md -e 85
  text-compress compress -d ./my-project
  text-compress compress -f notes.md -s 4000
  text-compress decompress -f notes.txt
  text-compress decompress -f output.01.txt
  text-compress decompress -f my-project.txt
  text-compress decompress -t "<base64>" -o restored.txt

Every run prints analytics (encoding, size, ratio, time taken) after
writing the output.
`);
}

function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "-h" || command === "--help") {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const args = parseArgs(rest);

  const run = async () => {
    if (command === "compress") {
      await runCompress(args);
    } else if (command === "decompress") {
      runDecompress(args);
    } else {
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      process.exit(1);
    }
  };

  run().catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  });
}

main();
