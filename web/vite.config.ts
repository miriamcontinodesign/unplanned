import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `--config web/vite.config.ts` leaves root at the process cwd, which would make
// Vite look for index.html in the repo root. Pin it to this directory.
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy the API so the browser sees one origin and the session cookie just
    // works - no CORS, no SameSite complications in dev.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.ROADIO_HTTP_PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
