/**
 * @module cli/analytics
 *
 * Post-run statistics printed to stdout after each CLI command.
 */

/** Print a key/value analytics block below the main status line. */
export function printAnalytics(stats: Record<string, string | number>) {
  console.log("\n--- Analytics ---")
  for (const [key, value] of Object.entries(stats)) {
    console.log(`${key}: ${value}`)
  }
}

/** Build split-related analytics fields when output was split. */
export function splitAnalytics(
  splitChunkSize: number | undefined,
  outputParts: number,
): Record<string, string | number> {
  if (splitChunkSize === undefined) return {}
  return {
    "Split size (chars)": splitChunkSize,
    "Output parts": outputParts,
  }
}
