#!/usr/bin/env node
/**
 * CLI binary entry point (`txtc` command).
 *
 * This thin file exists because `package.json` points `"bin"."txtc"` at
 * `dist/cli.js`. All logic lives under `src/cli/`.
 */
import { main } from "./cli/main.js"

main()
