import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset URLs relative so the build works under /apps/music/ or any other path.
// Routing uses HashRouter: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react()],
  // 4325–4328 apiclient tests, 4331 drop, 4332 files dev, 4335/4336 mocks.
  server: { port: 4337, strictPort: true },
  preview: { port: 4337, strictPort: true },
  test: { environment: 'node' },
});
