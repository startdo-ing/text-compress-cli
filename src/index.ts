/**
 * @module index
 *
 * Public API barrel — re-exports everything consumers import from
 * `@startdoing/tc`. Internal modules (`streaming/`, `cli/`) are not
 * exported here; only this file defines the npm package surface.
 *
 * @example
 * ```ts
 * import { compress, decompress, compressFolder } from "txtc";
 * ```
 */

// Folder API
export { compressFolder, decompressToPath } from "./api/folder.js"

// Text API
export { compress, decompress } from "./api/text.js"
// Archive unpack (exposed for advanced use / tests)
export { unpackDirectory } from "./archive/unpack.js"
// Path validation helpers
export { assertDirectory, readTextFile } from "./fs/paths.js"
// Low-level payload access
export { decompressPayload, TAG_FOLDER, TAG_TEXT } from "./payload/tags.js"
export type { SplitChunk } from "./split/parts.js"
// Split-file helpers
export {
  AUTO_SPLIT_CHARS,
  assembleSplitChunks,
  createSplitChunkHeader,
  extractFilenamePrefix,
  formatSplitOutputPath,
  parseSplitBuffer,
  parseSplitPartPath,
  readSplitInput,
  resolveSplitChunkSize,
  resolveSplitInputPaths,
  SPLIT_MAGIC,
  splitString,
  tryParseSplitChunks,
  wrapSplitChunk,
} from "./split/parts.js"
export type { Encoding } from "./types.js"
