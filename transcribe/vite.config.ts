import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// ONNX Runtime Web loads its WebAssembly binary (and, for some paths, the Emscripten glue) by
// URL, and transformers.js points it at jsDelivr by default. Self-host both: copy them into
// dist/ort/ and serve them from node_modules in dev. The worker sets
// env.backends.onnx.wasm.wasmPaths to this folder (resolved against the page URL).
const ORT_PKG = JSON.parse(readFileSync(new URL('./node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8')) as { version: string };
const ORT_FILES = ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'];
// Versioned folder, so a dependency upgrade can't pair new JS with a cached old binary.
const ORT_DIR = `ort/${ORT_PKG.version}`;

// ORT's bundle also contains `new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url)` as its
// default location. Vite would emit a second, hashed 21 MB copy for it. That default is never
// used (the worker always sets wasmPaths), so hide the pattern from Vite's asset detection.
// The worker is a separate Rollup build, so this must be in `worker.plugins` too.
function ortNoDefaultUrl(): Plugin {
  return {
    name: 'transcribe-ort-no-default-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') || !code.includes('import.meta.url')) return null;
      const out = code.replace(/new URL\((["'])(ort-[\w.-]+\.(?:wasm|mjs))\1,\s*import\.meta\.url\)/g, 'new URL($1$2$1, "" + import.meta.url)');
      return out === code ? null : { code: out, map: null };
    },
  };
}

function ortAssets(): Plugin {
  const src = (name: string) => fileURLToPath(new URL(`./node_modules/onnxruntime-web/dist/${name}`, import.meta.url));
  return {
    name: 'transcribe-ort-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/ort\/[^/]+\/([^/?#]+)/);
        if (!m || !ORT_FILES.includes(m[1]) || !existsSync(src(m[1]))) return next();
        res.setHeader('Content-Type', m[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(src(m[1])));
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) this.emitFile({ type: 'asset', fileName: `${ORT_DIR}/${name}`, source: readFileSync(src(name)) });
      this.emitFile({
        type: 'asset',
        fileName: `${ORT_DIR}/NOTICE.txt`,
        source: `onnxruntime-web ${ORT_PKG.version}\nCopyright (c) Microsoft Corporation. MIT License.\nhttps://github.com/microsoft/onnxruntime\n`,
      });
    },
  };
}

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/transcribe/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react(), ortNoDefaultUrl(), ortAssets()],
  define: { __ORT_DIR__: JSON.stringify(ORT_DIR), __ORT_VERSION__: JSON.stringify(ORT_PKG.version) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  worker: { format: 'es', plugins: () => [ortNoDefaultUrl()] },
  // transformers.js and ORT ship pre-bundled ESM with top-level await; esbuild pre-bundling breaks them in dev.
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
  test: { environment: 'node' },
});
