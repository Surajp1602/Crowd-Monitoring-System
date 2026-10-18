import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Media from tools/film.mjs lives in public/media and is copied as-is; raw generations stay in juried/raw.
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  server: { host: true },
});
