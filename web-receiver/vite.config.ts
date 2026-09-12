import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import basicSsl from "@vitejs/plugin-basic-ssl"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

const https = process.env.HTTPS === "1"
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }

// Trusted cert from `mkcert` (see README) — falls back to an untrusted
// self-signed cert via @vitejs/plugin-basic-ssl when absent.
const certDir = join(root, ".certs")
const keyPath = join(certDir, "dev-key.pem")
const certPath = join(certDir, "dev-cert.pem")
const hasMkcert = existsSync(keyPath) && existsSync(certPath)

function git(args: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

export default defineConfig({
  define: {
    __TC_VERSION__: JSON.stringify(pkg.version),
    __TC_GIT_SHA__: JSON.stringify(git("rev-parse --short HEAD")),
    __TC_GIT_BRANCH__: JSON.stringify(git("rev-parse --abbrev-ref HEAD")),
    __TC_GIT_DIRTY__: JSON.stringify(git("status --porcelain").length > 0),
  },
  plugins: [svelte(), ...(https && !hasMkcert ? [basicSsl()] : [])],
  server: {
    host: true,
    ...(https && hasMkcert
      ? { https: { key: readFileSync(keyPath), cert: readFileSync(certPath) } }
      : {}),
  },
  preview: {
    host: true,
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["zxing-wasm"],
  },
})
