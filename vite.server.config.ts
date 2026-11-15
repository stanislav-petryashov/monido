import { defineConfig } from 'vite'

// The server bundled with no external dependencies (main.js and reset-password.js plus the lazy-loaded locale chunks in assets/): the container does not need node_modules.
export default defineConfig({
  // the built server's marker (src/server/serverBuild.d.ts): config.ts defaults DATA_DIR to ./data here, to ./data-dev under tsx
  define: { __SERVER_BUILD__: 'true' },
  build: {
    ssr: true,
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      // the server and the reset-password command (deploy/docker/reset-password runs the second)
      input: { main: 'src/server/main.ts', 'reset-password': 'src/server/cli/resetPassword.ts' },
      output: { entryFileNames: '[name].js', format: 'es' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
