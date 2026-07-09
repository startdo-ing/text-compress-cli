/**
 * @module cli/analytics
 *
 * Post-run summary printed to stdout after each CLI command.
 */

import { getVersion } from "./version.js"

/** Print package version and exit (for `-V` / `--version`). */
export function printVersion(): void {
  console.log(`text-compress v${getVersion()}`)
}

/** Format a byte count for human-readable CLI output. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"] as const
  let value = bytes / 1024
  for (const unit of units) {
    if (value < 1024) {
      const digits = value < 10 ? 1 : 0
      return `${value.toFixed(digits)} ${unit}`
    }
    value /= 1024
  }
  return `${value.toFixed(1)} TB`
}

/** Format integers with thousands separators. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US")
}

export interface RunSummary {
  title: string
  outputPaths: string[]
  stats: Record<string, string | number>
}

/** Print a versioned, aligned summary block after a successful run. */
export function printRunSummary(summary: RunSummary): void {
  console.log(`text-compress v${getVersion()}`)
  console.log()
  console.log(summary.title)

  if (summary.outputPaths.length > 1) {
    for (const path of summary.outputPaths) {
      console.log(`  ${path}`)
    }
  } else if (summary.outputPaths.length === 1) {
    console.log(`  ${summary.outputPaths[0]}`)
  }

  if (Object.keys(summary.stats).length === 0) return

  console.log()
  const width = Math.max(...Object.keys(summary.stats).map((key) => key.length))
  for (const [key, value] of Object.entries(summary.stats)) {
    console.log(`  ${key.padEnd(width)}  ${value}`)
  }
}

/** Build split-related analytics fields when output was split. */
export function splitAnalytics(
  splitChunkSize: number | undefined,
  outputParts: number,
): Record<string, string | number> {
  if (splitChunkSize === undefined) return {}
  return {
    "Split limit": `${formatCount(splitChunkSize)} chars / part`,
    Parts: outputParts,
  }
}
