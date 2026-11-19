import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSP_HEADER =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none';";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      fs: path.resolve(__dirname, 'src/shims/fs.ts'),
      'node:fs': path.resolve(__dirname, 'src/shims/fs.ts'),
      stream: path.resolve(__dirname, 'src/shims/stream.ts'),
      'node:stream': path.resolve(__dirname, 'src/shims/stream.ts'),
    },
  },
  server: {
    headers: {
      'Content-Security-Policy': CSP_HEADER,
    },
  },
  preview: {
    headers: {
      'Content-Security-Policy': CSP_HEADER,
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
