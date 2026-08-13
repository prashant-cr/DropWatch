import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('./src/web', import.meta.url));
const distWeb = fileURLToPath(new URL('./dist/web', import.meta.url));
const srcRoot = fileURLToPath(new URL('./src', import.meta.url));

// The API port the dev server proxies to. Keep in sync with the server default.
const API_PORT = Number(process.env.PORT ?? 3070);

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    alias: { '@shared': `${srcRoot}/shared` },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: distWeb,
    emptyOutDir: true,
  },
});
