import basicSsl from "@vitejs/plugin-basic-ssl"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

const https = process.env.HTTPS === "1"

export default defineConfig({
  plugins: [svelte(), ...(https ? [basicSsl()] : [])],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
