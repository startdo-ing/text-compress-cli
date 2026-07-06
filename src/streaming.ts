import {
	closeSync,
	createReadStream,
	createWriteStream,
	mkdtempSync,
	openSync,
	readdirSync,
	readSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	brotliCompressSync,
	createBrotliCompress,
	constants as zlibConstants,
} from "node:zlib";
import {
	type Encoding,
	formatSplitOutputPath,
	resolveSplitChunkSize,
	TAG_FOLDER,
} from "./index.js";

const COPY_CHUNK = 1024 * 1024;
const ENCODE_READ_CHUNK = 3 * 1024 * 1024;

interface ArchiveStats {
	fileCount: number;
	dirCount: number;
	originalBytes: number;
	archiveBytes: number;
}

function writeDirEntry(fd: number, relPath: string) {
	const pathBuf = Buffer.from(relPath, "utf-8");
	const pathLenBuf = Buffer.alloc(4);
	pathLenBuf.writeUInt32LE(pathBuf.length, 0);
	writeSync(fd, Buffer.from([0x44]));
	writeSync(fd, pathLenBuf);
	writeSync(fd, pathBuf);
}

function writeFileEntry(fd: number, relPath: string, filePath: string): number {
	const pathBuf = Buffer.from(relPath, "utf-8");
	const pathLenBuf = Buffer.alloc(4);
	pathLenBuf.writeUInt32LE(pathBuf.length, 0);
	const contentLen = statSync(filePath).size;
	const contentLenBuf = Buffer.alloc(4);
	contentLenBuf.writeUInt32LE(contentLen, 0);

	writeSync(fd, Buffer.from([0x46]));
	writeSync(fd, pathLenBuf);
	writeSync(fd, pathBuf);
	writeSync(fd, contentLenBuf);

	const srcFd = openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(COPY_CHUNK);
		let copied = 0;
		while (copied < contentLen) {
			const toRead = Math.min(buf.length, contentLen - copied);
			const n = readSync(srcFd, buf, 0, toRead, copied);
			if (n <= 0) break;
			writeSync(fd, buf, 0, n);
			copied += n;
		}
	} finally {
		closeSync(srcFd);
	}

	return contentLen;
}

function buildArchiveFile(rootDir: string, archivePath: string): ArchiveStats {
	const fd = openSync(archivePath, "w");
	let fileCount = 0;
	let dirCount = 0;
	let originalBytes = 0;

	function walk(absDir: string, relDir: string) {
		if (relDir !== "") {
			writeDirEntry(fd, relDir);
			dirCount++;
		}

		const dirents = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		for (const dirent of dirents) {
			const abs = join(absDir, dirent.name);
			const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				walk(abs, rel);
			} else if (dirent.isFile()) {
				originalBytes += writeFileEntry(fd, rel, abs);
				fileCount++;
			}
		}
	}

	try {
		walk(rootDir, "");
	} finally {
		closeSync(fd);
	}

	return {
		fileCount,
		dirCount,
		originalBytes,
		archiveBytes: statSync(archivePath).size,
	};
}

function prependTagStream(tag: number, filePath: string): Readable {
	const tagBuf = Buffer.from([tag]);
	const file = createReadStream(filePath);
	return Readable.from(
		(async function* () {
			yield tagBuf;
			for await (const chunk of file) {
				yield chunk;
			}
		})(),
	);
}

async function brotliCompressFile(
	inputPath: string,
	outputPath: string,
): Promise<void> {
	await pipeline(
		prependTagStream(TAG_FOLDER, inputPath),
		createBrotliCompress({
			params: {
				[zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
				[zlibConstants.BROTLI_PARAM_LGWIN]:
					zlibConstants.BROTLI_MAX_WINDOW_BITS,
				[zlibConstants.BROTLI_PARAM_SIZE_HINT]: statSync(inputPath).size + 1,
			},
		}),
		createWriteStream(outputPath),
	);
}

function estimatedEncodedLength(
	binaryBytes: number,
	encoding: Encoding,
): number {
	if (encoding === 64) return Math.ceil(binaryBytes / 3) * 4;
	const padded = 1 + binaryBytes + ((4 - ((binaryBytes + 1) % 4)) % 4);
	return (padded / 4) * 5;
}

const Z85_ALPHABET =
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

function z85EncodeBuffer(buffer: Buffer): string {
	let out = "";
	for (let i = 0; i < buffer.length; i += 4) {
		let value =
			buffer[i] * 16777216 +
			buffer[i + 1] * 65536 +
			buffer[i + 2] * 256 +
			buffer[i + 3];
		const chars = new Array(5);
		for (let j = 4; j >= 0; j--) {
			chars[j] = Z85_ALPHABET[value % 85];
			value = Math.floor(value / 85);
		}
		out += chars.join("");
	}
	return out;
}

function openPart(outputPath: string, partIndex: number, totalParts: number) {
	const path = formatSplitOutputPath(outputPath, partIndex, totalParts);
	const fd = openSync(path, "w");
	return { path, fd };
}

function encodeBinaryFileToTextFiles(
	inputPath: string,
	outputPath: string,
	encoding: Encoding,
	split?: number,
): string[] {
	const binaryBytes = statSync(inputPath).size;
	const srcFd = openSync(inputPath, "r");

	const readAndEncode = (writeEncoded: (text: string) => void) => {
		if (encoding === 64) {
			const buf = Buffer.alloc(ENCODE_READ_CHUNK);
			let pos = 0;
			while (pos < binaryBytes) {
				const toRead = Math.min(buf.length, binaryBytes - pos);
				const n = readSync(srcFd, buf, 0, toRead, pos);
				if (n <= 0) break;
				writeEncoded(buf.subarray(0, n).toString("base64"));
				pos += n;
			}
		} else {
			const raw = Buffer.alloc(binaryBytes);
			let pos = 0;
			while (pos < binaryBytes) {
				const n = readSync(srcFd, raw, pos, binaryBytes - pos, pos);
				if (n <= 0) break;
				pos += n;
			}
			const padLength = (4 - ((raw.length + 1) % 4)) % 4;
			const padded = Buffer.concat([
				Buffer.from([padLength]),
				raw,
				Buffer.alloc(padLength),
			]);
			writeEncoded(z85EncodeBuffer(padded));
		}
	};

	if (!split) {
		const outFd = openSync(outputPath, "w");
		try {
			readAndEncode((text) => writeSync(outFd, text));
		} finally {
			closeSync(srcFd);
			closeSync(outFd);
		}
		return [outputPath];
	}

	const encodedLength = estimatedEncodedLength(binaryBytes, encoding);
	const totalParts = Math.ceil(encodedLength / split);
	const paths: string[] = [];

	let partIndex = 1;
	let part = openPart(outputPath, partIndex, totalParts);
	paths.push(part.path);
	let partChars = 0;

	const flushPart = () => {
		closeSync(part.fd);
		if (partIndex < totalParts) {
			partIndex++;
			part = openPart(outputPath, partIndex, totalParts);
			paths.push(part.path);
			partChars = 0;
		}
	};

	const writeEncoded = (text: string) => {
		let offset = 0;
		while (offset < text.length) {
			const remaining = split - partChars;
			if (remaining <= 0) {
				flushPart();
				continue;
			}
			const slice = text.slice(offset, offset + remaining);
			writeSync(part.fd, slice);
			partChars += slice.length;
			offset += slice.length;
			if (partChars >= split && offset < text.length) flushPart();
		}
	};

	try {
		readAndEncode(writeEncoded);
	} finally {
		closeSync(srcFd);
		closeSync(part.fd);
	}

	return paths;
}

export interface CompressFolderToPathResult extends ArchiveStats {
	outputPaths: string[];
	compressedBytes: number;
	splitChunkSize?: number;
}

export async function compressFolderToPath(
	dirPath: string,
	outputPath: string,
	encoding: Encoding = 64,
	split?: number,
): Promise<CompressFolderToPathResult> {
	const tempDir = mkdtempSync(join(tmpdir(), "text-compress-"));
	const archivePath = join(tempDir, "archive.bin");
	const compressedPath = join(tempDir, "compressed.bin");

	try {
		const stats = buildArchiveFile(dirPath, archivePath);
		await brotliCompressFile(archivePath, compressedPath);
		const compressedBytes = statSync(compressedPath).size;
		const encodedLength = estimatedEncodedLength(compressedBytes, encoding);
		const splitChunkSize = resolveSplitChunkSize(encodedLength, split);
		const outputPaths = encodeBinaryFileToTextFiles(
			compressedPath,
			outputPath,
			encoding,
			splitChunkSize,
		);
		return { ...stats, compressedBytes, outputPaths, splitChunkSize };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// Small in-memory brotli helper kept for tests / text mode parity checks.
export function brotliCompressBuffer(input: Buffer): Buffer {
	return brotliCompressSync(input, {
		params: {
			[zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
			[zlibConstants.BROTLI_PARAM_LGWIN]: zlibConstants.BROTLI_MAX_WINDOW_BITS,
			[zlibConstants.BROTLI_PARAM_SIZE_HINT]: input.length,
		},
	});
}
