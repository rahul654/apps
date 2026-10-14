import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// ONNX Runtime Web loads its WebAssembly glue (.mjs) and binary (.wasm) by URL at runtime.
// Self-host them under dist/ort-<version>/ (never a CDN) and point `env.wasm.wasmPaths` there.
// Two builds are shipped: the plain CPU one (~14 MB) and the JSEP WebGPU one (~28 MB, also runs CPU);
// the app downloads only the one it needs. The newer native WebGPU build (ort.webgpu.*, "asyncify")
// fails on BiRefNet: its 1025-input Concat / 33-output Split need more storage buffers per shader
// than adapters allow ("Too many storage buffers in shader. Current: 11, Max is 10").
const ORT_PKG = fileURLToPath(new URL('./node_modules/onnxruntime-web', import.meta.url));
const ORT_VERSION = JSON.parse(readFileSync(join(ORT_PKG, 'package.json'), 'utf8')).version as string;
const ORT_DIR = `ort-${ORT_VERSION}`;
const ORT_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];

// The npm package declares MIT but ships no LICENSE file, so write the notice out here.
const ORT_LICENSE = `ONNX Runtime Web ${ORT_VERSION} (https://github.com/microsoft/onnxruntime)

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function ortAssets(): Plugin {
  return {
    name: 'bgremover-ort-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/ort-[^/]+\/([^/?#]+)/);
        if (!m || !ORT_FILES.includes(m[1])) return next();
        const file = join(ORT_PKG, 'dist', m[1]);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', m[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) {
        this.emitFile({ type: 'asset', fileName: `${ORT_DIR}/${name}`, source: readFileSync(join(ORT_PKG, 'dist', name)) });
      }
      this.emitFile({ type: 'asset', fileName: `${ORT_DIR}/LICENSE.txt`, source: ORT_LICENSE });
    },
  };
}

// A small service worker so the app opens offline after the first visit. Its precache list is the
// app shell from this build; the ORT runtime is cached the first time it is used, and the model
// weights live in their own Cache Storage bucket managed by the inference worker.
function serviceWorker(): Plugin {
  return {
    name: 'bgremover-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const shell = Object.keys(bundle).filter((f) => !f.startsWith(`${ORT_DIR}/`) && !f.endsWith('.map'));
      const files = ['./', ...shell.map((f) => `./${f}`)];
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(fileURLToPath(new URL('./src/sw-template.js', import.meta.url)), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files))
        .replace('__ORT_DIR__', ORT_DIR);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/bgremover/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react(), ortAssets(), serviceWorker()],
  define: { __ORT_DIR__: JSON.stringify(ORT_DIR) },
  resolve: {
    // Use the builds that fetch their wasm glue from `wasmPaths` instead of the "bundle" builds,
    // which make Vite emit a second, hashed copy of the 14–28 MB .wasm files.
    // "onnxruntime-web/webgpu" is pointed at the JSEP build (ort.min.mjs); see ORT_FILES above.
    alias: [
      { find: /^onnxruntime-web\/wasm$/, replacement: join(ORT_PKG, 'dist/ort.wasm.min.mjs') },
      { find: /^onnxruntime-web\/webgpu$/, replacement: join(ORT_PKG, 'dist/ort.min.mjs') },
    ],
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'node' },
});
