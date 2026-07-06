import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

export type Encoding = 64 | 85;

// Z85 (ZeroMQ RFC 32) alphabet: avoids quotes, backslash, and backticks, unlike
// standard Ascii85 — safer to paste as-is into chat/code contexts.
const Z85_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

function z85Encode(buffer: Buffer): string {
  let out = "";
  for (let i = 0; i < buffer.length; i += 4) {
    let value = buffer[i] * 16777216 + buffer[i + 1] * 65536 + buffer[i + 2] * 256 + buffer[i + 3];
    const chars = new Array(5);
    for (let j = 4; j >= 0; j--) {
      chars[j] = Z85_ALPHABET[value % 85];
      value = Math.floor(value / 85);
    }
    out += chars.join("");
  }
  return out;
}

function z85Decode(str: string): Buffer {
  if (str.length % 5 !== 0) throw new Error("Invalid base85 (Z85) input length.");
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 5) {
    let value = 0;
    for (let j = 0; j < 5; j++) {
      const digit = Z85_ALPHABET.indexOf(str[i + j]);
      if (digit === -1) throw new Error(`Invalid base85 (Z85) character: "${str[i + j]}"`);
      value = value * 85 + digit;
    }
    bytes.push(
      Math.floor(value / 16777216) % 256,
      Math.floor(value / 65536) % 256,
      Math.floor(value / 256) % 256,
      value % 256,
    );
  }
  return Buffer.from(bytes);
}

// Z85 requires input length to be a multiple of 4 bytes. Prefix a 1-byte pad
// count so arbitrary-length data round-trips exactly.
function encodeBase85(buffer: Buffer): string {
  const padLength = (4 - ((buffer.length + 1) % 4)) % 4;
  const padded = Buffer.concat([Buffer.from([padLength]), buffer, Buffer.alloc(padLength)]);
  return z85Encode(padded);
}

function decodeBase85(str: string): Buffer {
  const padded = z85Decode(str);
  const padLength = padded[0];
  return padded.subarray(1, padded.length - padLength);
}

function encodeBuffer(buffer: Buffer, encoding: Encoding): string {
  if (encoding === 64) return buffer.toString("base64");
  if (encoding === 85) return encodeBase85(buffer);
  throw new Error(`Unsupported encoding: ${encoding}`);
}

function decodeBuffer(str: string, encoding: Encoding): Buffer {
  if (encoding === 64) return Buffer.from(str, "base64");
  if (encoding === 85) return decodeBase85(str);
  throw new Error(`Unsupported encoding: ${encoding}`);
}

function brotliCompress(input: Buffer): Buffer {
  return brotliCompressSync(input, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_LGWIN]: zlibConstants.BROTLI_MAX_WINDOW_BITS,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: input.length,
    },
  });
}

// Payloads are tagged so `decompress` can tell text apart from a packed
// folder archive without the caller having to track what was compressed.
export const TAG_TEXT = 0x01;
export const TAG_FOLDER = 0x02;

function wrapPayload(tag: number, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), data]);
}

export function compress(text: string, encoding: Encoding = 64): string {
  const payload = wrapPayload(TAG_TEXT, Buffer.from(text, "utf-8"));
  return encodeBuffer(brotliCompress(payload), encoding);
}

export function decompress(encoded: string, encoding: Encoding = 64): string {
  const raw = brotliDecompressSync(decodeBuffer(encoded, encoding));
  if (raw[0] !== TAG_TEXT) {
    throw new Error("This payload is a compressed folder, not text. Use decompressToPath.");
  }
  return raw.subarray(1).toString("utf-8");
}

// --- Folder archive format ---
// A flat sequence of entries, each either a directory marker or a file:
//   directory: [0x44] [pathLen: u32le] [path bytes]
//   file:      [0x46] [pathLen: u32le] [path bytes] [contentLen: u32le] [content bytes]
// Paths are POSIX-style (forward slashes) and relative to the archive root.
// File/folder attributes (permissions, timestamps) are intentionally dropped.

interface ArchiveEntry {
  type: "d" | "f";
  relPath: string;
  content?: Buffer;
}

function collectEntries(rootDir: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];

  function walk(absDir: string, relDir: string) {
    if (relDir !== "") entries.push({ type: "d", relPath: relDir });

    const dirents = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const dirent of dirents) {
      const abs = join(absDir, dirent.name);
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        walk(abs, rel);
      } else if (dirent.isFile()) {
        entries.push({ type: "f", relPath: rel, content: readFileSync(abs) });
      }
    }
  }

  walk(rootDir, "");
  return entries;
}

function serializeArchive(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const pathBuf = Buffer.from(entry.relPath, "utf-8");
    const pathLenBuf = Buffer.alloc(4);
    pathLenBuf.writeUInt32LE(pathBuf.length, 0);

    if (entry.type === "d") {
      chunks.push(Buffer.from([0x44]), pathLenBuf, pathBuf);
    } else {
      const content = entry.content ?? Buffer.alloc(0);
      const contentLenBuf = Buffer.alloc(4);
      contentLenBuf.writeUInt32LE(content.length, 0);
      chunks.push(Buffer.from([0x46]), pathLenBuf, pathBuf, contentLenBuf, content);
    }
  }
  return Buffer.concat(chunks);
}

function deserializeArchive(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const type = buffer[offset];
    offset += 1;
    const pathLen = buffer.readUInt32LE(offset);
    offset += 4;
    const relPath = buffer.subarray(offset, offset + pathLen).toString("utf-8");
    offset += pathLen;

    if (relPath.startsWith("/") || relPath.split("/").includes("..")) {
      throw new Error(`Unsafe path in archive: "${relPath}"`);
    }

    if (type === 0x44) {
      entries.push({ type: "d", relPath });
    } else if (type === 0x46) {
      const contentLen = buffer.readUInt32LE(offset);
      offset += 4;
      const content = buffer.subarray(offset, offset + contentLen);
      offset += contentLen;
      entries.push({ type: "f", relPath, content });
    } else {
      throw new Error(`Corrupt archive: unknown entry type byte 0x${type.toString(16)}`);
    }
  }
  return entries;
}

export function unpackDirectory(
  buffer: Buffer,
  destDir: string,
): { files: number; dirs: number; bytes: number } {
  mkdirSync(destDir, { recursive: true });
  const entries = deserializeArchive(buffer);

  let files = 0;
  let dirs = 0;
  let bytes = 0;
  for (const entry of entries) {
    const destPath = join(destDir, ...entry.relPath.split("/"));
    if (entry.type === "d") {
      mkdirSync(destPath, { recursive: true });
      dirs++;
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      const content = entry.content ?? Buffer.alloc(0);
      writeFileSync(destPath, content);
      files++;
      bytes += content.length;
    }
  }
  return { files, dirs, bytes };
}

export function compressFolder(dirPath: string, encoding: Encoding = 64) {
  const entries = collectEntries(dirPath);
  const archive = serializeArchive(entries);
  const encoded = encodeBuffer(brotliCompress(wrapPayload(TAG_FOLDER, archive)), encoding);
  const files = entries.filter((e) => e.type === "f");
  const originalBytes = files.reduce((sum, e) => sum + (e.content?.length ?? 0), 0);
  return {
    encoded,
    fileCount: files.length,
    dirCount: entries.length - files.length,
    originalBytes,
    archiveBytes: archive.length,
  };
}

export function decompressPayload(encoded: string, encoding: Encoding): { tag: number; data: Buffer } {
  const raw = brotliDecompressSync(decodeBuffer(encoded, encoding));
  return { tag: raw[0], data: raw.subarray(1) };
}

export function decompressToPath(encoded: string, destDir: string, encoding: Encoding = 64) {
  const { tag, data } = decompressPayload(encoded, encoding);
  if (tag !== TAG_FOLDER) {
    throw new Error("This payload is compressed text, not a folder. Use decompress.");
  }
  return unpackDirectory(data, destDir);
}

export function splitString(value: string, chunkSize: number): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`Split size must be a positive integer, got ${chunkSize}.`);
  }
  if (value.length === 0) return [""];

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

export function formatSplitOutputPath(outputPath: string, partIndex: number, totalParts: number): string {
  const part = String(partIndex).padStart(String(totalParts).length, "0");
  const slash = Math.max(outputPath.lastIndexOf("/"), outputPath.lastIndexOf("\\"));
  const dot = outputPath.lastIndexOf(".");
  const hasExtension = dot > slash;

  if (hasExtension) {
    return outputPath.slice(0, dot) + `.${part}` + outputPath.slice(dot);
  }
  return `${outputPath}.${part}`;
}

function splitFilename(name: string): { baseName: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { baseName: name, extension: "" };
  return { baseName: name.slice(0, dot), extension: name.slice(dot) };
}

export function parseSplitPartPath(filePath: string): { baseName: string; partIndex: number; extension: string } | null {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = filePath.slice(slash + 1);

  const withExtension = name.match(/^(.+)\.(\d+)(\.[^.]+)$/);
  if (withExtension) {
    return {
      baseName: withExtension[1],
      partIndex: Number(withExtension[2]),
      extension: withExtension[3],
    };
  }

  const withoutExtension = name.match(/^(.+)\.(\d+)$/);
  if (withoutExtension) {
    return {
      baseName: withoutExtension[1],
      partIndex: Number(withoutExtension[2]),
      extension: "",
    };
  }

  return null;
}

function listSplitPartPaths(dir: string, baseName: string, extension: string): string[] {
  const prefix = `${baseName}.`;
  const suffix = extension;

  const parts = readdirSync(dir)
    .filter((name) => {
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
      const middle = name.slice(prefix.length, name.length - suffix.length);
      return /^\d+$/.test(middle);
    })
    .map((name) => ({
      path: join(dir, name),
      partIndex: Number(name.slice(prefix.length, name.length - suffix.length)),
    }))
    .sort((a, b) => a.partIndex - b.partIndex);

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].partIndex !== i + 1) {
      throw new Error(`Missing split part ${i + 1} for "${baseName}${extension}".`);
    }
  }

  return parts.map((part) => part.path);
}

export function resolveSplitInputPaths(inputPath: string): string[] {
  const parsed = parseSplitPartPath(inputPath);
  if (parsed) {
    const dir = dirname(inputPath);
    const paths = listSplitPartPaths(dir, parsed.baseName, parsed.extension);
    if (paths.length === 0) {
      throw new Error(`Split part not found: ${inputPath}`);
    }
    return paths;
  }

  if (existsSync(inputPath)) {
    return [inputPath];
  }

  const dir = dirname(inputPath);
  const slash = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"));
  const name = inputPath.slice(slash + 1);
  const { baseName, extension } = splitFilename(name);

  try {
    const paths = listSplitPartPaths(dir, baseName, extension);
    if (paths.length > 0) return paths;
  } catch {
    // Fall through to not-found error below.
  }

  throw new Error(`Input file not found: ${inputPath}`);
}

export function readSplitInput(inputPath: string): { content: string; partPaths: string[] } {
  const partPaths = resolveSplitInputPaths(inputPath);
  const content = partPaths.map((path) => readFileSync(path, "utf-8")).join("");
  return { content, partPaths };
}
