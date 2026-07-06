/**
 * @module archive/types
 *
 * Data structures for the custom folder archive format.
 */

/**
 * A single entry in a folder archive — either a directory marker or a file.
 *
 * Directories carry only a relative path; files carry path + binary content.
 * This flat list representation (vs a nested tree) simplifies both
 * serialization and streaming writes.
 */
export interface ArchiveEntry {
	/** `"d"` = directory marker, `"f"` = file with content. */
	type: "d" | "f";
	/** POSIX-style relative path (forward slashes, no leading `/`). */
	relPath: string;
	/** File content; absent for directory entries. */
	content?: Buffer;
}

/** Directory entry type byte on the wire. */
export const ENTRY_DIR = 0x44;

/** File entry type byte on the wire (`"F"` in ASCII). */
export const ENTRY_FILE = 0x46;
