import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  root: 'client',
  // In dev, Vite serves client/public directly at /assets. For a production
  // build we do NOT copy it: that is ~170 MB of CC0 art, and the game server
  // serves it in place instead (see the /assets handler in server/index.ts).
  publicDir: command === 'serve' ? 'public' : false,
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
}));
