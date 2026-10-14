import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Excalidraw loads its hand-drawn and CJK fonts by URL at runtime and falls back to esm.sh
// when they're missing. Copy them into dist/fonts/ at build time and serve them from
// node_modules in dev. src/lib/assetPath.ts points window.EXCALIDRAW_ASSET_PATH here.
function excalidrawFonts(): Plugin {
  const fontsDir = fileURLToPath(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'whiteboard-excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/^\/fonts\/([^?#]+)/);
        if (!m) return next();
        const file = normalize(join(fontsDir, decodeURIComponent(m[1])));
        if (!file.startsWith(fontsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const file of walk(fontsDir)) {
        this.emitFile({ type: 'asset', fileName: `fonts/${relative(fontsDir, file).split('\\').join('/')}`, source: readFileSync(file) });
      }
    },
  };
}

const EXCALIDRAW_DIST = String.raw`[\/]@excalidraw[\/]excalidraw[\/]dist[\/]prod[\/]`;
const EXCALIDRAW_CORE = new RegExp(`${EXCALIDRAW_DIST}index\.js$`);
// Excalidraw's esbuild output names these by content hash; they hold its env constants and
// esbuild runtime helpers, and import nothing.
const EXCALIDRAW_SHARED = new RegExp(`${EXCALIDRAW_DIST}chunk-(ZUYEQ4TG|SRAX5OIU)\.js$`);

// `base: './'` makes every asset URL relative, so the build works from any
// sub-path (e.g. https://<user>.github.io/apps/whiteboard/) without hard-coding it.
// Routing uses HashRouter for the same reason: GitHub Pages has no SPA fallback.
export default defineConfig({
  base: './',
  plugins: [react(), excalidrawFonts()],
  build: {
    target: 'es2022',
    // The editor (Excalidraw) and Mermaid are lazy chunks; the boards list stays small. The
    // largest chunk (~1.8 MB) is Excalidraw's font subsetter (HarfBuzz/WOFF2 WASM inlined), which
    // loads only when exporting SVG/PNG with text.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Excalidraw's font-subsetting worker is a module worker started from its own chunk URL.
        // Left alone, Rollup lets that chunk import helpers from the editor chunk (already loaded
        // on the main thread), which in turn imports React and our app entry: the worker then
        // crashes and Excalidraw falls back to subsetting on the main thread. Keep the two tiny
        // dependency-free helper modules the worker shares with the editor in their own chunk.
        manualChunks: (id) => (EXCALIDRAW_SHARED.test(id) ? 'excalidraw-shared' : undefined),
        // Name Excalidraw's core chunk instead of whatever module Rollup picks (a locale file).
        chunkFileNames: (chunk) => (chunk.moduleIds.some((id) => EXCALIDRAW_CORE.test(id)) ? 'assets/excalidraw-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: { port: 4323, strictPort: true },
  preview: { port: 4323, strictPort: true },
  test: { environment: 'node', testTimeout: 20000 },
});
