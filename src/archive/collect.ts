/**
 * @module archive/collect
 *
 * In-memory directory tree walker that produces a flat {@link ArchiveEntry}
 * list suitable for {@link serializeArchive}.
 *
 * ## Traversal algorithm
 *
 * Depth-first pre-order walk with sorted children:
 *
 * 1. Emit a directory marker for every non-root directory.
 * 2. For each child (sorted by `localeCompare`), recurse into subdirs or
 *    read file content into memory.
 *
 * This path loads every file into RAM — use the streaming builder in
 * `streaming/folder.ts` for large directory trees.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchiveEntry } from "./types.js";

/**
 * Walk a directory tree and collect all entries into a flat array.
 *
 * @param rootDir - Absolute path to the folder root.
 */
export function collectEntries(rootDir: string): ArchiveEntry[] {
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
