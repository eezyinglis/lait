import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset URLs relative so the build works from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  // One ~500 kB bundle (≈150 kB gzipped) is fine for an installed, offline-cached app.
  build: { chunkSizeWarningLimit: 700 },
});
