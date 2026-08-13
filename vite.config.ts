import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  // Relative base so the build works from any path, including a GitHub Pages
  // project site (https://<user>.github.io/<repo>/).
  base: './',
  // The CC0 art is ~170 MB and is fetched by tools/fetch-assets.mjs into
  // client/public. Copy it into every build so the game is fully self-hosting
  // (GitHub Pages has no file server to serve it in place).
  publicDir: 'public',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    strictPort: false,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
