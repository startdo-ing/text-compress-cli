/**
 * @module cli/output
 *
 * Write compressed output to disk, optionally split into numbered parts.
 */

import { writeFileSync } from "node:fs";
import {
	formatSplitOutputPath,
	resolveSplitChunkSize,
	splitString,
} from "../split/parts.js";

/**
 * Write an encoded string to one file or multiple split part files.
 */
export function writeCompressedOutput(
	encoded: string,
	outputPath: string,
	explicitSplit?: number,
): { paths: string[]; splitChunkSize?: number } {
	const splitChunkSize = resolveSplitChunkSize(encoded.length, explicitSplit);
	if (splitChunkSize === undefined) {
		writeFileSync(outputPath, encoded, "utf-8");
		return { paths: [outputPath] };
	}

	const chunks = splitString(encoded, splitChunkSize);
	const paths = chunks.map((chunk, index) => {
		const partPath = formatSplitOutputPath(
			outputPath,
			index + 1,
			chunks.length,
		);
		writeFileSync(partPath, chunk, "utf-8");
		return partPath;
	});
	return { paths, splitChunkSize };
}
