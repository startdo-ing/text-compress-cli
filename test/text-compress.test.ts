import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AUTO_SPLIT_CHARS,
	assertDirectory,
	compress,
	compressFolder,
	decompress,
	decompressPayload,
	decompressToPath,
	formatSplitOutputPath,
	parseSplitPartPath,
	readSplitInput,
	readTextFile,
	resolveSplitChunkSize,
	resolveSplitInputPaths,
	splitString,
	TAG_TEXT,
	unpackDirectory,
} from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "text-compress-"));
	tempDirs.push(dir);
	return dir;
}

describe("text compression", () => {
	it("round-trips text with base64", () => {
		const input = "Hello, world! This is a test of brotli compression.";
		expect(decompress(compress(input, 64), 64)).toBe(input);
	});

	it("round-trips text with base85", () => {
		const input = "Hello, world! This is a test of brotli compression.";
		expect(decompress(compress(input, 85), 85)).toBe(input);
	});

	it("round-trips empty string", () => {
		expect(decompress(compress("", 64), 64)).toBe("");
	});

	it("round-trips unicode text", () => {
		const input = "日本語 🎉 émojis and spëcial chars";
		expect(decompress(compress(input, 64), 64)).toBe(input);
		expect(decompress(compress(input, 85), 85)).toBe(input);
	});

	it("tags text payloads correctly", () => {
		const encoded = compress("hello", 64);
		const { tag } = decompressPayload(encoded, 64);
		expect(tag).toBe(TAG_TEXT);
	});

	it("rejects folder payload in decompress()", () => {
		const dir = makeTempDir();
		mkdirSync(join(dir, "sub"));
		writeFileSync(join(dir, "sub", "a.txt"), "content");
		const { encoded } = compressFolder(dir, 64);
		expect(() => decompress(encoded, 64)).toThrow(/compressed folder/);
	});
});

describe("folder compression", () => {
	it("round-trips a folder tree", () => {
		const src = makeTempDir();
		mkdirSync(join(src, "nested"));
		writeFileSync(join(src, "readme.txt"), "hello");
		writeFileSync(join(src, "nested", "data.json"), '{"x":1}');

		const { encoded } = compressFolder(src, 64);
		const dest = makeTempDir();
		const stats = decompressToPath(encoded, dest, 64);

		expect(stats.files).toBe(2);
		expect(readFileSync(join(dest, "readme.txt"), "utf-8")).toBe("hello");
		expect(readFileSync(join(dest, "nested", "data.json"), "utf-8")).toBe(
			'{"x":1}',
		);
	});

	it("round-trips folder with base85", () => {
		const src = makeTempDir();
		writeFileSync(join(src, "file.txt"), "z85 test");

		const { encoded } = compressFolder(src, 85);
		const dest = makeTempDir();
		decompressToPath(encoded, dest, 85);

		expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("z85 test");
	});

	it("reports file and directory counts", () => {
		const src = makeTempDir();
		mkdirSync(join(src, "a"));
		mkdirSync(join(src, "b"));
		writeFileSync(join(src, "a", "1.txt"), "1");
		writeFileSync(join(src, "b", "2.txt"), "22");

		const result = compressFolder(src, 64);
		expect(result.fileCount).toBe(2);
		expect(result.dirCount).toBe(2);
		expect(result.originalBytes).toBe(3);
	});
});

describe("unpackDirectory", () => {
	it("rejects unsafe archive paths", () => {
		const badArchive = Buffer.concat([
			Buffer.from([0x46]),
			(() => {
				const p = Buffer.from("../evil", "utf-8");
				const len = Buffer.alloc(4);
				len.writeUInt32LE(p.length, 0);
				return Buffer.concat([len, p]);
			})(),
			(() => {
				const c = Buffer.from("x", "utf-8");
				const len = Buffer.alloc(4);
				len.writeUInt32LE(c.length, 0);
				return Buffer.concat([len, c]);
			})(),
		]);

		expect(() => unpackDirectory(badArchive, makeTempDir())).toThrow(
			/Unsafe path/,
		);
	});
});

describe("split output", () => {
	it("splits a string into fixed-size chunks", () => {
		expect(splitString("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
	});

	it("returns a single empty chunk for empty input", () => {
		expect(splitString("", 10)).toEqual([""]);
	});

	it("rejects invalid split sizes", () => {
		expect(() => splitString("abc", 0)).toThrow(/positive integer/);
		expect(() => splitString("abc", 1.5)).toThrow(/positive integer/);
	});

	it("formats numbered output paths before the extension", () => {
		expect(formatSplitOutputPath("output.txt", 1, 3)).toBe("output.1.txt");
		expect(formatSplitOutputPath("output.txt", 2, 12)).toBe("output.02.txt");
		expect(formatSplitOutputPath("archive", 5, 5)).toBe("archive.5");
	});

	it("round-trips split compressed output when concatenated", () => {
		const input = "Split test payload.\n".repeat(100);
		const encoded = compress(input, 64);
		const parts = splitString(encoded, 40);
		expect(decompress(parts.join(""), 64)).toBe(input);
	});

	it("discovers and reads numbered split part files", () => {
		const dir = makeTempDir();
		const basePath = join(dir, "output.txt");
		const encoded = compress("split file round trip", 64);
		const chunks = splitString(encoded, 10);

		const paths = chunks.map((chunk, index) => {
			const partPath = formatSplitOutputPath(
				basePath,
				index + 1,
				chunks.length,
			);
			writeFileSync(partPath, chunk, "utf-8");
			return partPath;
		});

		expect(parseSplitPartPath(paths[0])).toEqual({
			baseName: "output",
			partIndex: 1,
			extension: ".txt",
		});
		expect(resolveSplitInputPaths(paths[2])).toEqual(paths);
		expect(readSplitInput(join(dir, "output.txt")).content).toBe(encoded);
		expect(decompress(readSplitInput(paths[0]).content, 64)).toBe(
			"split file round trip",
		);
	});

	it("errors when split parts are missing", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "output.1.txt"), "a");
		writeFileSync(join(dir, "output.3.txt"), "c");
		expect(() => resolveSplitInputPaths(join(dir, "output.1.txt"))).toThrow(
			/Missing split part 2/,
		);
	});

	it("auto-splits above 30,000 characters when -s is omitted", () => {
		expect(resolveSplitChunkSize(30_000)).toBeUndefined();
		expect(resolveSplitChunkSize(30_001)).toBe(AUTO_SPLIT_CHARS);
		expect(resolveSplitChunkSize(50_000, 4_000)).toBe(4_000);
	});
});

describe("input path validation", () => {
	it("rejects -f input when the path is a directory", () => {
		const dir = makeTempDir();
		expect(() => readTextFile(dir, "compress")).toThrow(/is a directory/);
		expect(() => readTextFile(dir, "decompress")).toThrow(
			/compressed .txt file/,
		);
		expect(() => resolveSplitInputPaths(dir)).toThrow(/is a directory/);
		expect(() => readSplitInput(dir)).toThrow(/is a directory/);
	});

	it("rejects -d input when the path is a file", () => {
		const dir = makeTempDir();
		const file = join(dir, "notes.txt");
		writeFileSync(file, "hello");
		expect(() => assertDirectory(file)).toThrow(/is not a directory/);
	});
});

describe("base85 encoding", () => {
	it("produces smaller output than base64 for larger payloads", () => {
		const input = "The quick brown fox jumps over the lazy dog.\n".repeat(200);
		const b64 = compress(input, 64);
		const b85 = compress(input, 85);
		expect(b85.length).toBeLessThan(b64.length);
	});
});
