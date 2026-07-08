#!/usr/bin/env node
/**
 * CLI binary entry point (`text-compress` command).
 *
 * This thin file exists because `package.json` points `"bin"."text-compress"` at
 * `dist/cli.js`. All logic lives under `src/cli/`.
 */
import { main } from "./cli/main.js"

main()
