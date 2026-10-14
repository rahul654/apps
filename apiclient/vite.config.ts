import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Ships the dependency-free local proxy next to the app so it can be downloaded from the Proxy page. */
function copyProxy(): Plugin {
  return {
    name: 'apiclient-copy-proxy',
    apply: 'build',
    closeBundle() {
      mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
      copyFileSync(resolve(__dirname, 'proxy/apiclient-proxy.mjs'), resolve(__dirname, 'dist/apiclient-proxy.mjs'));
    },
  };
}

// `base: './'` keeps every asset URL relative so the build works from any sub-path
// (https://<user>.github.io/apps/apiclient/). Routing uses HashRouter: Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react(), copyProxy()],
  build: { target: 'es2022' },
  test: { environment: 'node', testTimeout: 20000 },
});
