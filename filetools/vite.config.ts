import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// pdf.js fetches CMaps (for CJK and other non-Latin PDFs) and standard font data
// on demand. Copy them into dist/pdfjs/ at build time and serve them from
// node_modules in dev, so the app references them with a relative URL.
function pdfjsAssets(): Plugin {
  const pkg = fileURLToPath(new URL('./node_modules/pdfjs-dist', import.meta.url));
  const dirs = ['cmaps', 'standard_fonts'];
  return {
    name: 'filetools-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/pdfjs\/(cmaps|standard_fonts)\/([^/?#]+)/);
        const file = m && join(pkg, m[1], decodeURIComponent(m[2]));
        if (!file || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const name of readdirSync(join(pkg, dir))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(pkg, dir, name)) });
        }
      }
    },
  };
}

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/filetools/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react(), pdfjsAssets()],
  build: {
    // pdf.js 4 uses top-level await and other ES2022 features.
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  worker: { format: 'es' },
  test: { environment: 'node', testTimeout: 20000 },
});
