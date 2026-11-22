import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/files/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react()],
  // 4325–4328 apiclient tests, 4331 drop, 4335 gate mock, 4336 this app's mock Apps Script.
  server: { port: 4332, strictPort: true },
  preview: { port: 4332, strictPort: true },
  test: { environment: 'node' },
});
