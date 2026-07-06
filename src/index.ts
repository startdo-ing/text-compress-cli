/**
 * @module index
 *
 * Public API barrel — re-exports everything consumers import from
 * `@startdoing/tc`. Internal modules (`streaming/`, `cli/`) are not
 * exported here; only this file defines the npm package surface.
 *
 * @example
 * ```ts
 * import { compress, decompress, compressFolder } from "@startdoing/tc";
 * ```
 */

// Folder API
export { compressFolder, decompressToPath } from "./api/folder.js";

// Text API
export { compress, decompress } from "./api/text.js";
// Archive unpack (exposed for advanced use / tests)
export { unpackDirectory } from "./archive/unpack.js";
// Path validation helpers
export { assertDirectory, readTextFile } from "./fs/paths.js";
// Low-level payload access
export { decompressPayload, TAG_FOLDER, TAG_TEXT } from "./payload/tags.js";

// Split-file helpers
export {
	AUTO_SPLIT_CHARS,
	formatSplitOutputPath,
	parseSplitPartPath,
	readSplitInput,
	resolveSplitChunkSize,
	resolveSplitInputPaths,
	splitString,
} from "./split/parts.js";
export type { Encoding } from "./types.js";
