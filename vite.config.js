import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 2000 },
});
