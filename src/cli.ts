#!/usr/bin/env node
/**
 * CLI binary entry point (`tc` command).
 *
 * This thin file exists because `package.json` points `"bin"."tc"` at
 * `dist/cli.js`. All logic lives under `src/cli/`.
 */
import { main } from "./cli/main.js";

main();
