import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/recorder/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    // Mediabunny (trim/convert) is loaded lazily and is the largest chunk.
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
  test: { environment: 'node', testTimeout: 20000 },
});
