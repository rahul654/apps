import { copyFileSync, mkdirSync } from 'node:fs';
import { build as esbuild } from 'esbuild';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Ships the downloadable tools next to the app: the dependency-free local proxy, its Linux launcher
 * installer, and the Postman export/import scripts bundled with their dependencies (fflate, ajv) into
 * single standalone files, so the one-line commands on the Proxy and Postman pages need no npm install.
 */
function copyProxy(): Plugin {
  return {
    name: 'apiclient-copy-proxy',
    apply: 'build',
    async closeBundle() {
      await esbuild({
        entryPoints: ['scripts/export-from-postman.mjs', 'scripts/import-to-postman.mjs'].map((p) => resolve(__dirname, p)),
        outdir: resolve(__dirname, 'dist'),
        outExtension: { '.js': '.mjs' },
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node18',
        legalComments: 'inline',
        // CommonJS dependencies (ajv) call require(); give the ESM bundle one.
        banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
        logLevel: 'warning',
      });
      mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
      copyFileSync(resolve(__dirname, 'proxy/apiclient-proxy.mjs'), resolve(__dirname, 'dist/apiclient-proxy.mjs'));
      copyFileSync(resolve(__dirname, 'proxy/install-launcher.sh'), resolve(__dirname, 'dist/install-launcher.sh'));
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
