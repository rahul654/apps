import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/splitwise/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
