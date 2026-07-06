/**
 * @module cli/paths
 *
 * Output path resolution for CLI commands.
 */

import { resolve } from "node:path";
import type { Args } from "./args.js";

/**
 * Derive an output path from input args or use an explicit `-o` value.
 *
 * Prevents accidentally overwriting the input file when defaults collide.
 */
export function resolveOutputPath(
	args: Args,
	fallbackName: string,
	suffix: string,
): string {
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
