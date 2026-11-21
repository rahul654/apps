import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { workerWrapperSource } from './src/lib/ocr/stderr';

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

// tesseract.js loads its worker script and its WebAssembly core by URL (from a CDN by
// default). Self-host them: copy the worker and the LSTM-only cores (plain, SIMD and
// relaxed-SIMD; the worker picks one) into dist/ocr/tesseract-<version>/.
const TESS_VERSION = JSON.parse(readFileSync(new URL('./node_modules/tesseract.js/package.json', import.meta.url), 'utf8')).version as string;
const OCR_DIR = `ocr/tesseract-${TESS_VERSION}`;

function tesseractAssets(): Plugin {
  const files: Record<string, string> = {
    'worker.min.js': fileURLToPath(new URL('./node_modules/tesseract.js/dist/worker.min.js', import.meta.url)),
  };
  for (const v of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
    files[v] = fileURLToPath(new URL(`./node_modules/tesseract.js-core/${v}`, import.meta.url));
  }
  files['LICENSE-tesseract.js.txt'] = fileURLToPath(new URL('./node_modules/tesseract.js/LICENSE.md', import.meta.url));
  files['LICENSE-tesseract.js-core.txt'] = fileURLToPath(new URL('./node_modules/tesseract.js-core/LICENSE', import.meta.url));
  // Bundled tessdata_fast language files keep their names (tesseract.js expects <lang>.traineddata.gz).
  const tessdataDir = fileURLToPath(new URL('./src/assets/ocr/tessdata_fast', import.meta.url));
  const tessdata: Record<string, string> = {};
  for (const f of readdirSync(tessdataDir)) tessdata[f] = join(tessdataDir, f);
  return {
    name: 'filetools-tesseract-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/ocr\/tesseract-[^/]+\/([^/?#]+)/);
        const t = req.url?.match(/\/ocr\/tessdata_fast\/([^/?#]+)/);
        if (m && m[1] === 'worker-wrapper.js') {
          res.setHeader('Content-Type', 'text/javascript');
          return res.end(workerWrapperSource('worker.min.js'));
        }
        const file = (m && files[m[1]]) || (t && tessdata[t[1]]);
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `${OCR_DIR}/${name}`, source: readFileSync(file) });
      }
      this.emitFile({ type: 'asset', fileName: `${OCR_DIR}/worker-wrapper.js`, source: workerWrapperSource('worker.min.js') });
      for (const [name, file] of Object.entries(tessdata)) {
        this.emitFile({ type: 'asset', fileName: `ocr/tessdata_fast/${name}`, source: readFileSync(file) });
      }
    },
  };
}

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/filetools/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react(), pdfjsAssets(), tesseractAssets()],
  define: { __OCR_ASSET_DIR__: JSON.stringify(OCR_DIR) },
  build: {
    // pdf.js 4 uses top-level await and other ES2022 features.
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  worker: { format: 'es' },
  test: { environment: 'node', testTimeout: 20000 },
});
