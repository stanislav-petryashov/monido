import { defineConfig } from 'vite'

// The server bundled with no external dependencies (main.js, reset-password.js and mcp-stdio.js plus the lazy-loaded locale chunks in assets/): the container does not need node_modules.
export default defineConfig({
  // the built server's marker (src/server/serverBuild.d.ts): config.ts defaults DATA_DIR to ./data here, to ./data-dev under tsx
  define: { __SERVER_BUILD__: 'true' },
  build: {
    ssr: true,
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      // the server and the two commands (deploy/docker/reset-password and deploy/docker/monido-mcp run them)
      input: { main: 'src/server/main.ts', 'reset-password': 'src/server/cli/resetPassword.ts', 'mcp-stdio': 'src/server/cli/mcpStdio.ts' },
      output: { entryFileNames: '[name].js', format: 'es' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
