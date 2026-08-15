import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    // The portable ZIP is copied around and synced; size is a usability property.
    chunkSizeWarningLimit: 600,
  },
});
