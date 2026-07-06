/**
 * @module cli/main
 *
 * CLI entry logic — parses argv, dispatches to compress/decompress commands.
 */

import { parseArgs, resolveInputArgs } from "./args.js";
import { runCompress } from "./commands/compress.js";
import { runDecompress } from "./commands/decompress.js";
import { printUsage } from "./usage.js";

/** Main CLI dispatcher. */
export function main() {
	const [, , command, ...rest] = process.argv;

	if (!command || command === "-h" || command === "--help") {
		printUsage();
		process.exit(command ? 0 : 1);
	}

	const args = parseArgs(rest);

	const run = async () => {
		if (command === "compress") {
			resolveInputArgs(args, "compress");
			await runCompress(args);
		} else if (command === "decompress") {
			resolveInputArgs(args, "decompress");
			runDecompress(args);
		} else {
			console.error(`Unknown command: ${command}\n`);
			printUsage();
			process.exit(1);
		}
	};

	run().catch((err) => {
		console.error(`Error: ${(err as Error).message}`);
		process.exit(1);
	});
}
