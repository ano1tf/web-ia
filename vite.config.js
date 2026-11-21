import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Le build de la console est servi par Express (server/index.js).
  build: { outDir: 'dist', emptyOutDir: true },
});
