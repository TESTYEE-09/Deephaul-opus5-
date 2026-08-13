import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  publicDir: false,
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
