import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import basicSsl from "@vitejs/plugin-basic-ssl"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

const https = process.env.HTTPS === "1"
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
) as { version: string }

export default defineConfig({
  define: {
    __TC_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [svelte(), ...(https ? [basicSsl()] : [])],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
