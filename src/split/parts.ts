/**
 * @module split/parts
 *
 * Split-file I/O for oversized compressed strings.
 *
 * Chat platforms and some editors impose character limits (~30 000–50 000).
 * This module splits a long encoded string into numbered part files and
 * reassembles them on read.
 *
 * ## Naming convention
 *
 * Parts are inserted before the extension with zero-padded indices:
 *
 * ```
 *   output.txt  →  output.1.txt, output.2.txt, … output.12.txt
 *   archive     →  archive.1, archive.2, …
 * ```
 *
 * Zero-padding width matches the total part count so lexical sort equals
 * numeric sort (`output.02.txt` before `output.10.txt`).
 *
 * ## Auto-split threshold
 *
 * When no explicit `-s` size is given, outputs longer than
 * {@link AUTO_SPLIT_CHARS} are automatically split. This default targets
 * common paste limits while keeping part counts manageable.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { readTextFile } from "../fs/paths.js";

/** Default character threshold for automatic output splitting. */
export const AUTO_SPLIT_CHARS = 30_000;

/**
 * Decide whether and how to split encoded output.
 *
 * @param encodedLength - Total characters in the encoded string.
 * @param explicitSplit - User-provided `-s` value, if any.
 * @returns Chunk size, or `undefined` when no split is needed.
 */
export function resolveSplitChunkSize(
	encodedLength: number,
	explicitSplit?: number,
): number | undefined {
	if (explicitSplit !== undefined) return explicitSplit;
	if (encodedLength > AUTO_SPLIT_CHARS) return AUTO_SPLIT_CHARS;
	return undefined;
}

/**
 * Split a string into fixed-size chunks (last chunk may be shorter).
 *
 * @throws If `chunkSize` is not a positive integer.
 */
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

/**
 * Build the filesystem path for one part of a split output.
 *
 * Inserts `.<paddedIndex>` before the file extension.
 */
export function formatSplitOutputPath(
	outputPath: string,
	partIndex: number,
	totalParts: number,
): string {
	const part = String(partIndex).padStart(String(totalParts).length, "0");
	const slash = Math.max(
		outputPath.lastIndexOf("/"),
		outputPath.lastIndexOf("\\"),
	);
	const dot = outputPath.lastIndexOf(".");
	const hasExtension = dot > slash;

	if (hasExtension) {
		return `${outputPath.slice(0, dot)}.${part}${outputPath.slice(dot)}`;
	}
	return `${outputPath}.${part}`;
}

/** Split a filename into base name and extension (e.g. `"out.txt"` → `"out"`, `".txt"`). */
function splitFilename(name: string): { baseName: string; extension: string } {
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return { baseName: name, extension: "" };
	return { baseName: name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * Parse a split-part filename back into its components.
 *
 * @returns `null` if the path does not match the split naming pattern.
 */
export function parseSplitPartPath(
	filePath: string,
): { baseName: string; partIndex: number; extension: string } | null {
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

/**
 * List all part files for a split set in a directory, verifying contiguity.
 *
 * @throws If any part number is missing (e.g. part 2 absent while part 3 exists).
 */
function listSplitPartPaths(
	dir: string,
	baseName: string,
	extension: string,
): string[] {
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
		.filter(({ path }) => statSync(path).isFile())
		.sort((a, b) => a.partIndex - b.partIndex);

	for (let i = 0; i < parts.length; i++) {
		if (parts[i].partIndex !== i + 1) {
			throw new Error(
				`Missing split part ${i + 1} for "${baseName}${extension}".`,
			);
		}
	}

	return parts.map((part) => part.path);
}

/**
 * Resolve an input path to one or more part file paths.
 *
 * Accepts a single file, a split part (auto-discovers siblings), or a
 * non-existent path that matches a split naming pattern in its directory.
 */
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
		const stat = statSync(inputPath);
		if (stat.isDirectory()) {
			throw new Error(
				`"${inputPath}" is a directory, not a compressed file. Pass the compressed .txt file.`,
			);
		}
		if (stat.isFile()) {
			return [inputPath];
		}
		throw new Error(`Cannot read "${inputPath}": not a regular file.`);
	}

	const dir = dirname(inputPath);
	const slash = Math.max(
		inputPath.lastIndexOf("/"),
		inputPath.lastIndexOf("\\"),
	);
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

/**
 * Read and concatenate all parts for a split (or single) compressed input.
 */
export function readSplitInput(inputPath: string): {
	content: string;
	partPaths: string[];
} {
	const partPaths = resolveSplitInputPaths(inputPath);
	const content = partPaths
		.map((path) => readTextFile(path, "decompress"))
		.join("");
	return { content, partPaths };
}
