import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Client. The server is built separately: vite.server.config.ts. In dev the API is proxied to tsx watch (port 8080).
export default defineConfig({
  plugins: [react(), {
    name: 'onest-language-subsets',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/@fontsource-variable/onest/index.css')) return
      // Keep every language subset; specialized math/symbol glyphs use the system fallback.
      return code.replace(/\/\* onest-(?:math|symbols)-wght-normal \*\/\s*@font-face\s*\{[^}]*\}/g, '')
    },
  }],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // dist/client/.vite/manifest.json lists the chunks and their imports: .size-limit.mjs builds the bundle budgets from it.
    manifest: true,
    // The ECharts chunk is about 600 kB by design; .size-limit.mjs is the real budget, so Vite's default 500 kB warning is only noise.
    chunkSizeWarningLimit: 700,
  },
  // The object form keeps the browser's Host: the string shorthand sets changeOrigin, and the server's same-origin check then rejects every write
  server: { proxy: { '/api': { target: 'http://localhost:8080' } } },
})
