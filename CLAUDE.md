# CLAUDE.md

Guidance for working in this repo.

## What this is

A **multi-app repo** published to GitHub Pages at `https://rahul654.github.io/apps/`.
Each top-level folder with a buildable `package.json` is a separate app, served at `/apps/<folder>/`.
The repo root itself is not an npm workspace. Every app has its own `node_modules` and lockfile.

```
apps/                          ← git root; repo name "apps" = the /apps URL prefix
├── index.html                 ← landing page at /apps/ (plain HTML, no build step)
├── 404.html                   ← GitHub Pages not-found page
├── package.json               ← root scripts only: build / preview
├── scripts/
│   ├── build-site.mjs         ← discovers apps, installs, tests, builds, assembles _site/
│   └── preview.mjs            ← serves _site/ under /apps/ to mirror Pages locally
├── .github/workflows/deploy.yml  ← on push to main: build-site → deploy to Pages
├── README.md                  ← how to run + host on GitHub Pages
├── splitwise/                 ← expense splitting (Vite + React 19 + TypeScript)
├── devtools/                  ← developer utilities, one route per tool
├── filetools/                 ← PDF / image / QR tools, all client-side
├── recorder/                  ← screen + webcam recorder, recordings kept in IndexedDB
├── sandbox/                   ← open websites in sandboxed iframes + HTML playground
├── bgremover/                 ← background remover, ONNX models in a worker
├── transcribe/                ← speech to text, Whisper in a worker
├── whiteboard/                ← Excalidraw whiteboard + diagrams, boards in IndexedDB
└── apiclient/                 ← Postman-style API client, Postman v2.1 model in IndexedDB
```

`_site/`, `dist/` and `node_modules/` are build output and are git-ignored.

## Rules every app must follow

1. **Build to `<app>/dist/`** via `npm run build`. `build-site.mjs` copies it to `_site/<app>/`.
2. **Relative asset URLs.** For Vite use `base: './'`. Never hard-code `/apps/<app>/`, so the app keeps working if the repo or folder is renamed.
3. **Hash routing** (`HashRouter`). GitHub Pages has no SPA fallback, so `BrowserRouter` deep links would 404 on refresh.
4. **No backend.** Everything is static. Persist data client-side (localStorage) and namespace keys per app, e.g. `splitwise:data:v1`.
5. Add the app to the card list in the root `index.html`.
6. An optional `test` script runs automatically before the build in CI. A failing test blocks the deploy.

## Commands

| Where | Command | Purpose |
| --- | --- | --- |
| root | `npm run build` | Build all apps into `_site/` |
| root | `npm run preview` | Serve `_site/` at http://localhost:4173/apps/ |
| `splitwise/` | `npm run dev` | Vite dev server with HMR |
| `splitwise/` | `npm test` | Vitest unit tests (split + balance maths) |
| `splitwise/` | `npm run build` | Type-check (`tsc -b`) and build to `dist/` |
| `devtools/`, `filetools/`, `recorder/`, `sandbox/`, `bgremover/`, `transcribe/`, `whiteboard/`, `apiclient/` | same `dev` / `test` / `build` scripts | Each app is self-contained |

## Dev Tools (`devtools/`)

Developer utilities, one route per tool (`#/json`, `#/regex`, `#/converters/color`, …). `src/tools/registry.ts` is the single list driving the sidebar, home grid and routes; every tool is `React.lazy`.

- **Privacy rule:** tool *inputs* are never written to localStorage (people paste tokens and secrets). They live in memory only (`hooks/memoryState.ts`). Only preferences are persisted, under `devtools:prefs:v1`.
- Heavy work (JSON parse/diff, regex, hashing, text diff) runs in one module worker (`src/workers/`). `ComputeClient` is "latest wins": a new request on a busy worker terminates it and starts a fresh one. That is what keeps a catastrophic regex from blocking the next one. The regex tool also has a 1.5 s timeout.
- MD5, cron parser/next-run, Myers diff, UUID v7 and colour maths are self-written in `src/lib/` and tested against published vectors. No runtime deps beyond React/router.

## File Tools (`filetools/`)

PDF, image and QR tools; all processing happens in the browser. `src/tools/registry.ts` drives home + routes; every tool is `React.lazy` so the home page doesn't load pdf.js/pdf-lib.

- **Libraries:** `pdf-lib` writes PDFs, `pdfjs-dist` 4.x (legacy build) renders them, `fflate` zips, `qrcode` generates, `jsqr` is the scanner fallback when `BarcodeDetector` is missing.
- **pdf.js worker** is emitted as `assets/pdf.worker.min-*.mjs`. Hosts must serve `.mjs` as JavaScript or PDFs won't open (GitHub Pages does; `scripts/preview.mjs` maps it too). A Vite plugin copies pdf.js CMaps/standard fonts to `dist/pdfjs/`.
- **PDF editor (`tools/pdf/editor/`, `lib/pdf/editorSave.ts`):** objects are stored in PDF user-space points. Screen ⇄ PDF mapping lives in `lib/coords.ts` and is tested against pdf.js's own viewport for rotations 0/90/180/270; change it only with those tests.
  - "Cover"/"White-out" only paint over content, and the UI says so.
  - "Redact" is real: affected pages are re-rendered to 200-dpi images with the box burned in, and the original content streams are dropped. This flattens forms on those pages.
  - **Rich text boxes** (`lib/text/`, `tools/pdf/editor/richtext/`): ProseMirror editor, model = box → paragraphs → styled runs (font, size, B/I/U/S, colour, highlight; paragraph align + line height).
    - `lib/text/layout.ts` is the single layout engine used for both on-screen display and the PDF writer, so line breaks match. Change it only with its tests.
    - Save strategy per box (`lib/text/strategy.ts`): WinAnsi in Helvetica/Times/Courier → standard fonts. Other scripts the bundled Noto fonts cover (Cyrillic, Greek, Vietnamese…) → embedded font, real text. Complex scripts (Indic, Arabic/Hebrew, Thai, CJK) and emoji → the whole box is rasterised to a 300-dpi image with a "not selectable" badge. Saving is never blocked.
    - Fonts: OFL families in `src/assets/fonts/<family>/` with their `OFL.txt`, registered in `lib/fonts/registry.ts` and loaded on demand. Noto and Caveat must be embedded in full: pdf-lib's subsetter drops their glyphs, and a test guards this.
- **OCR** (`lib/ocr/`, `tools/ocr/`, `tools/pdf/PdfOcrTool.tsx`): tesseract.js 7 in a small worker pool.
  - The worker, WASM cores and the English/Hindi `tessdata_fast` files are self-hosted under `dist/ocr/`; never point tesseract.js at a CDN for code.
  - Other languages and "Best" models download on demand from jsDelivr and are cached in IndexedDB.
  - Searchable PDFs get an invisible text layer (render mode 3) on the original page, using Tesseract's tiny "GlyphLessFont" with a Unicode mapping, so copy and search work for any script without downloading fonts.
  - Each word's angle, size and horizontal scale must be derived by mapping the box points through the same pixel→PDF transform as its position, including any OCR-time rotation. Taking the angle from `/Rotate` alone breaks pages whose content is upright but displayed sideways.
  - tesseract.js 7 can't take language data passed straight to `createWorker`; write it into its IndexedDB cache first.
- Image encoding runs in an OffscreenCanvas worker pool with a main-thread fallback. Output formats are feature-detected (`canvas.toBlob`), and EXIF orientation is applied before metadata is stripped.
- `DropZone` keeps its hidden `<input type=file>` *outside* the clickable zone. A programmatic `click()` inside it would bubble back to the zone's `onClick`.

## Recorder (`recorder/`)

Loom-style screen + webcam recorder. Recordings live in IndexedDB; nothing is uploaded.

- **Compositing** (`src/media/compositor.ts`, `src/workers/compositor.worker.ts`): screen + camera bubble are drawn into one canvas stream. Fallback chain: `worker-breakout` (Chromium stream processors + OffscreenCanvas in a worker), then `worker-spec`, then `main-canvas` redrawn from a worker timer. Force one with `&compositor=main-canvas`.
  - Never drive drawing from main-thread `requestAnimationFrame`: hidden tabs throttle it to ~1 Hz, which freezes the bubble.
  - To test the hidden-tab behaviour, use a Chromium launched *without* Playwright's `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` flags. With them, hidden tabs are never throttled and the test proves nothing.
- **Test mode:** `?fake=1` replaces screen, camera and mic with generated streams (clock + frame counter + tone). Use it for any automated check of the pipeline.
- **Crash safety:** MediaRecorder runs with a 1 s timeslice, and chunks go straight to IndexedDB (`lib/recordingStore.ts`). On load, unfinished sessions are offered for recovery, skipping ones another tab still holds a Web Lock on.
- **WebM duration:** `lib/webmDuration.ts` patches the duration into the EBML header after recording; without it, players can't seek.
- **Trim/convert:** `mediabunny` (MPL-2.0: fine to use unmodified; edits to its own files must be published), lazy-loaded in the `editor` chunk. Fast trim copies packets and starts at the previous key frame (Chromium is asked for one every 2 s); frame-accurate trim re-encodes. Don't use ffmpeg.wasm: GitHub Pages can't send the COOP/COEP headers its threaded build needs.
- **Formats:** chosen by `lib/mime.ts` from `MediaRecorder.isTypeSupported`: MP4 H.264/AAC where available (Chrome on Windows/macOS, Safari), else WebM VP9/Opus. MP4 conversion on Linux Chrome falls back to Opus audio, which QuickTime can't play.

## Sandbox (`sandbox/`)

Opens websites in sandboxed iframes; each sandbox is a tab. Also an HTML/JS playground (`srcdoc`) with a console. State is in `sandbox:data:v1` (`lib/storage.ts`), via `store/SandboxStore.tsx`.

- **Static site, so no proxy.** Sites sending `X-Frame-Options`/`frame-ancestors` (Google, GitHub, banks…) can't be framed, and the browser hides that from us. `lib/embed.ts` warns for a known list and turns YouTube/Vimeo links into their embed players. Don't claim to "unblock" sites.
- **Isolation rules (`lib/policy.ts`):** `allow-top-navigation` is never offered. `effectiveTokens` drops `allow-same-origin` for HTML sandboxes (srcdoc inherits our origin and could remove its own sandbox) and for URLs on this app's origin when scripts run. Keep those tests passing.
- **Frames are created imperatively (`components/SandboxFrame.tsx`):** sandbox/allow/`credentialless` must be set before insertion, and React drops `credentialless`. Any policy change remounts the frame via `key`.
- Frames stay mounted while their tab is hidden (`App.tsx`), so switching tabs doesn't reload pages. Element ids inside a sandbox must be unique per sandbox (`useId`).
- **Console bridge (`lib/consoleBridge.ts`):** `bridgeMain` is stringified into the srcdoc, so it must stay self-contained (no imports/outer vars). Messages are accepted only from that frame's window with the current run's channel id. Error lines are shifted back by the injected lines.

## Background Remover (`bgremover/`)

Removes image backgrounds on-device with ONNX Runtime Web (`onnxruntime-web` 1.30) in a module worker (`src/workers/segment.worker.ts`); `lib/engine.ts` is the main-thread client. Images are never uploaded; only prefs persist (`bgremover:prefs:v1`, `bgremover:theme`).

- **Models (`lib/models.ts`):** Fast = U²-Net-p (Apache-2.0, 4.4 MB), People = MODNet (Apache-2.0, 24.7 MB), Best quality = BiRefNet lite (MIT, 109 MB fp16 / 214 MB fp32, WebGPU-only, marked experimental and not yet confirmed on real GPU hardware). Weights download on demand from Hugging Face, pinned to a commit and checked against size + SHA-256 before use. Avoid `briaai/RMBG-*` (non-commercial) and `@imgly/background-removal` (AGPL). `planRun` picks backend/precision: fp16 only with `shader-f16`; small models stay on WASM when the only WebGPU adapter is a software fallback.
- **ORT self-hosting:** a Vite plugin copies the `.mjs` glue + `.wasm` into `dist/ort-<version>/` and the worker sets `env.wasm.wasmPaths` to it (from `document.baseURI`). `onnxruntime-web/wasm` and `/webgpu` are aliased to the non-"bundle" builds; the bundle builds make Vite emit a second hashed copy of the 14–27 MB wasm. Never load ORT code from a CDN.
- **Single-threaded:** GitHub Pages can't send COOP/COEP, so `numThreads = 1`. BiRefNet's fixed 1024×1024 input runs out of wasm32's 4 GB on CPU, hence WebGPU-only.
- **Wide-node rewrite (`lib/onnxRewrite.ts`):** before any WebGPU session the worker splits Concat/Split nodes wider than 6 into trees (BiRefNet has a 1024-input Concat and 32-output Splits that exceed the shader storage-buffer limit). Only the graph's node list is re-encoded; weights are copied byte for byte. Output is identical (tested through ORT in Node). Change it only with those tests.
- **Model cache:** weights live in Cache Storage `bgremover-models-v1`, keyed by the pinned HF URL (written by `lib/modelCache.ts` in the worker). The UI shows the size and asks before the first download of each model.
- **Service worker** (`src/sw-template.js`, emitted as `dist/sw.js` with a per-build precache list; registered in production only, so its scope is the app folder): navigations are network-first with cache fallback, hashed assets cache-first, `ort-<version>/` cached on first use. Lookups use `ignoreVary: true`, because hosts send `Vary: Origin` and module-script requests carry an Origin header the precache requests didn't (without it, offline loads fail).
- **Mask model (`lib/mask.ts`):** raw model mask → refine lookup table (threshold/softness) → signed brush layer (`Int8Array`, −127 erase … +127 restore). Original pixels are never modified. Strokes record dirty-rect patches for undo (`lib/history.ts`, byte-budgeted). Export (`lib/render.ts`) recomposes at original resolution; JPEG gets a white background when the background is transparent.
- **Testing:** `?webgpu=0` forces the CPU path. WebGPU in headless Chromium needs `--enable-unsafe-webgpu` and an http(s) localhost page (it's unavailable on `data:` URLs), and then it is SwiftShader: slow, no `shader-f16`.

## Speech to Text (`transcribe/`)

Whisper (`Xenova/whisper-tiny|base|small`, Apache-2.0) via transformers.js 3 in a module worker (`src/workers/whisper.worker.ts`). Nothing is uploaded, except in Live dictation (Web Speech API), which the UI labels as sending audio to the browser vendor.

- **ORT WASM is self-hosted** in `dist/ort/<ort-version>/` (vite.config.ts), and the worker sets `env.backends.onnx.wasm.wasmPaths` to it; otherwise transformers.js loads it from jsDelivr. ORT's bundle also has `new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url)`, which makes Vite emit a second 21 MB copy. A `transform` plugin hides it, and it must also be in `worker.plugins` because the worker is a separate Rollup build.
- **Single-threaded WASM** (`numThreads = 1`): Pages can't send COOP/COEP. WebGPU is used when `navigator.gpu.requestAdapter()` succeeds (dtype fp32 encoder + q4 decoder); WASM uses q8 for both. Sizes per backend are in `lib/models.ts`.
- **Model cache:** a custom Cache Storage `transcribe:models` (`env.useCustomCache`), not transformers' default `transformers-cache`, because the origin is shared with other apps. `media/modelCache.ts` lists and deletes by parsing the Hugging Face URLs used as keys.
- **Language detection is ours:** transformers.js v3 defaults to English. One decoder step after `<|startoftranscript|>`, argmax over `lang_to_id`.
- **Long audio** (`lib/merge.ts`): 30 s windows, 5 s stride. Merge by **word alignment**, not time. Whisper's timestamps near a window edge drift by seconds, and merging by time dropped whole sentences. Matched words must be within 10 s of each other (refrains otherwise match the wrong verse). If there's no match, fall back to cutting at the middle of the overlap. The two fixtures in `lib/__fixtures__/` are real per-window output; add one (`?debug=1` logs `transcribe:window` JSON) when changing the merge.
- **Repetition loops:** word-timestamp mode decodes without timestamp tokens and Tiny loops. A looping window is decoded again at segment level (word times interpolated), then `collapseLoops` removes what's left. Silent windows (RMS < −60 dBFS) are skipped.
- **Cancel = `worker.terminate()`**; the next run reloads the model from the cache. The current job lives in `store/job.ts` (outside React), so it survives navigation.
- **Decoding** uses a 16 kHz `OfflineAudioContext` (it resamples); `lib/audio.ts` has a windowed-sinc resampler as fallback. Audio files are stored as-is; video and mic recordings are stored as 16 kHz WAV (MediaRecorder WebM can't seek).
- **IndexedDB** `transcribe` (`transcripts`, `audio`); records go through `parseTranscript` on read and on JSON import. Prefs are in `transcribe:prefs:v1`.
- **`onnxruntime-node` and `sharp` are stubbed** via `overrides` → `stubs/` (the browser build never loads them; saves ~560 MB per install).
- **Testing:** jsdom's Blob survives neither fake-indexeddb nor `.text()`, so the smoke test mocks `getAudio` and reads blobs with FileReader. For the mic, use `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`; `?fake=1` swaps in a tone. Playwright downloads failed in a reused persistent profile but work in a fresh context. A SwiftShader WebGPU adapter (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`) runs the WebGPU path, very slowly.

## Whiteboard (`whiteboard/`)

Excalidraw-based whiteboard (`@excalidraw/excalidraw` 0.18, MIT). `#/` is the boards library; `#/b/:id` lazy-loads `components/BoardEditor.tsx`, so the list never downloads Excalidraw (~1.1 MB).

- **Fonts are self-hosted.** A Vite plugin copies `node_modules/@excalidraw/excalidraw/dist/prod/fonts` to `dist/fonts/` (and serves it in dev). `main.tsx` sets `window.EXCALIDRAW_ASSET_PATH` to the *absolute* URL of the page folder (`lib/assetPath.ts`): Excalidraw resolves a relative path against the origin, not the page, and silently falls back to esm.sh.
- **Worker chunk:** `vite.config.ts` puts Excalidraw's two small shared modules (`chunk-ZUYEQ4TG`, `chunk-SRAX5OIU`) in an `excalidraw-shared` chunk. Otherwise Rollup lets the font-subsetting worker import the editor chunk and the app entry, which crash in a worker. Those names are Excalidraw build hashes: after upgrading, check that `dist/assets/subset-worker.chunk-*.js` imports only `subset-shared` and `excalidraw-shared`.
- **No backend:** `aiEnabled={false}` (Text-to-diagram shows only the Mermaid tab), no collab or share-link, and CSS hides the library's "Browse libraries" button (that site returns items via an `#addLibrary=` hash, which would hit our router).
- **Storage:** IndexedDB `whiteboard` with stores `boards` (summaries), `scenes`, `files` (key `[boardId, id]`, pruned when no image uses them), `thumbs` (PNG data URL + revision) and `kv` (Excalidraw library). Store layout changes go in `db.ts`; record shape changes bump `SCHEMA_VERSION` (`lib/types.ts`) and add `MIGRATIONS[old]` in `lib/schema.ts`. Every record is validated on load; bad ones are hidden and counted, never deleted.
- **Autosave** (debounced, plus flush on `pagehide`/hidden tab/leaving the board): `lib/sceneSignature.ts` ignores `version`/`versionNonce`/`updated`, so opening a board or a font reflow isn't an edit. Scroll, zoom and tool styles are saved only on flush, with `touch: false`, which doesn't change `updatedAt`. Never save while `appState.isLoading`.
- **Templates** (`lib/templates.ts`) are built in code by `lib/elements.ts` with fractional indices, bound labels and two-way arrow bindings; `templates.test.ts` checks ids, indices and bindings.
- **Backup** is one JSON file (`whiteboard-backup`); re-importing skips identical boards and imports conflicting ids as copies.
- **Browser tests:** Chromium exports through the File System Access API (native save dialog), so delete `window.showSaveFilePicker` in an init script to observe downloads. The jsdom smoke test mocks `components/BoardEditor` (Excalidraw needs a canvas).

## API Client (`apiclient/`)

Postman-style API client with multiple workspaces. Everything lives in IndexedDB (`apiclient` DB, version 2) via `store/AppStore.tsx`; prefs (incl. `activeWorkspaceId`, proxy mode, theme) in `apiclient:prefs:v1` and are app-wide.

- **Workspaces** (`lib/workspaces.ts`): each has its own collections, environments, globals, active environment, history and runs. Default has the fixed id `'default'` (backups restore into it), sorts first, can be renamed, never deleted. Names are unique ignoring case (`uniqueWorkspaceName`).
- **Store:** state = all workspaces (`workspaces`, `data[wsId]`); pages read `state` = app state + the ACTIVE workspace's data (`viewOf`), so they see only the current workspace. Data actions carry `ws`; dispatch fills in the active one, and async work (RequestEditor send, RunnerPage) passes the workspace it started in, so late results land correctly. Actions for a deleted workspace are dropped. Persist writes are serialised through one promise chain. Pages with item state are keyed by workspace id in `App.tsx`; `useSwitchWorkspace` also leaves `/r|/c|/f|/env/:id|/runner/:id` routes.
- **DB layout v2** (`lib/db.ts`): `workspaces` (meta + globals + activeEnvironmentId), and `collections/environments/history/runs` keyed `['ws','id']` with rows `{ws, id, data}`; one workspace = key range `[ws]…[ws, []]` (`wsRange`). `replaceWorkspace`/`deleteWorkspace` are single transactions. The v1→v2 upgrade (everything into Default) runs inside the versionchange transaction; `db.test.ts` builds a v1 DB the old way and checks it. Store layout changes need a new `DB_VERSION` + upgrade step, tested the same way.
- **Unsaved request drafts** are kept per workspace in memory (`draftCount` shows them in the switcher); a mutable map, so `draftVersion` is deliberately a context memo dependency. Actions dispatched before IndexedDB opens are queued and flushed.
- **The internal model is Postman Collection v2.1** (`lib/postman/types.ts`), so import/export is lossless: keep unknown fields, never "convert". Every item/folder/response gets an `id` (schema-legal extra). `normalize.ts` upgrades v2.0. Exports are validated in tests with `ajv-draft-04` against `lib/postman/__schemas__/collection-v2.1.0.json` (official); `environment.json` there is hand-written because Postman publishes no reachable environment schema.
- **Zips** (`lib/workspace/zip.ts`, schemaVersion 2): a Postman folder holds ONLY Postman files (`collections/*.postman_collection.json`, `environments/*.postman_environment.json`, `globals.postman_globals.json`) so it can go to Postman's Import → Folders; app-only data (`workspace.json`, `history.json`, `runs/`) lives in `_apiclient/`. All-workspaces zip: `workspaces/<folder>/…`, `_apiclient/<folder>/…`, `manifest.json` (`kind:'all-workspaces'`, `workspaces:[{id,name,folder,isDefault}]`). Single workspace: Postman files at the top level, `_apiclient/`, `manifest.json` (`kind:'workspace'`). Names via `safePathSegment` + case-insensitive `uniqueSegment`. Tests assert every file in a Postman folder validates and nothing else is there; keep that.
- **Import** = `parseImportZip`/`parseLooseFiles`/`parseCurlImport` → groups → `planImport` (pure, `lib/workspace/importPlan.ts`) → `import/apply`. Strategies: `target` (flatten into an existing or new workspace), `restore` (all-workspaces zip, by id, names included), `per-postman` (script zip: routes files via `manifest.workspaces[].collections/environments[].file` and globals id `globals-<workspace id>`; merges into a same-named workspace or creates it). Merge/Replace only affect target workspaces. Also reads schemaVersion 1 zips, Postman "Export data" zips (detected by content), and zips of an exported folder (the manifest nearest the root sets the prefix). Keep `scripts/export-from-postman.mjs` (guide: `scripts/EXPORT-FROM-POSTMAN.md`) and its zip layout compatible with this.
- **Variable precedence is Postman's**: local > iteration data > environment > request > folder > collection > globals (`lib/variables.ts`); environment beats collection on purpose.
- **Scripts** (`lib/scripts/runtime.ts`): `sandboxMain` is stringified into a `sandbox="allow-scripts"` iframe (`host.ts`), so it must stay self-contained (no imports, no outer variables). chai is inlined from `chai/chai.js?raw`, loaded lazily on first run. Unit tests run the same function in-process via `node-env.ts`. `pm.sendRequest` is relayed to the host so it follows the direct/proxy mode. Scripts are stored in the Postman `event` array (`edit.ts: setEventCode`).
- `lib/execute.ts` is the single send pipeline (build → collection/folder/request pre-request scripts → send → test scripts → history + variable changes); the editor and the runner both use it. The runner (`lib/runner/runner.ts`) is pure with an injected executor.
- **Proxy**: `proxy/apiclient-proxy.mjs` is dependency-free Node, copied into `dist/` by the Vite plugin in `vite.config.ts`; `lib/proxy/proxy.test.ts` spawns it on port 4326 against a test server on 4325 (keep those ports free when running tests). Direct mode sends with `credentials: 'omit'` and can't set forbidden headers or read `Set-Cookie`; the UI says so rather than pretending.
- **CSS gotchas**: `.table-wrap` and `.topbar` must stay `position: relative`; absolutely positioned `.sr-only` labels inside an overflowing scroller otherwise resolve against the page and cause horizontal page scroll. The top bar fits 360–1440px only through its breakpoints (nav labels hidden ≤1280px, logo text hidden 1281–1440px, pickers shrink ≤1440px); at ≤900px the workspace picker moves to `.sidebar-switchers` on the Requests page (environment picker too at ≤640px) and only its Workspaces link stays in the top bar. Re-measure after adding top-bar items.
- `useToast` takes an optional action (`{label, onClick}`), used for Undo.
- Browser checks need a CORS-enabled test API; the request and response tab strips share names (Body, Headers), so scope selectors to `section[aria-label="Response"]`. A hash-only `page.goto` doesn't reload the document; reload after swapping builds. IndexedDB writes finish after the UI updates, so wait before reading the DB in a test.

## Splitwise app (`splitwise/`)

React 19 + TypeScript + Vite 6 + react-router-dom 7 (HashRouter). No UI library: plain CSS in `src/index.css` with CSS variables and a dark-mode media query.

```
src/
├── types.ts              ← data model (Person, Group, Expense, Transfer, AppData). ME = 'me'
├── lib/
│   ├── money.ts          ← parse/format; all money is INTEGER minor units (paise/cents)
│   ├── split.ts          ← equal / exact / percent / shares → Share[] (exact-sum rounding)
│   ├── balances.ts       ← net balances, per-expense transfers, ledger, simplifyDebts, allTransfers
│   ├── storage.ts        ← localStorage load/save/validate (key: splitwise:data:v1)
│   ├── demo.ts           ← sample data for "Load demo data"
│   ├── categories.ts     ← expense categories + group types
│   ├── date.ts, id.ts
│   └── *.test.ts         ← Vitest
├── store/AppStore.tsx    ← React context + useReducer; every mutation goes through an Action;
│                            reducer also appends to the activity log; persisted on every change;
│                            syncs across tabs via the `storage` event
├── components/           ← Layout (top bar + sidebar), Modal, ExpenseForm, SettleUpForm,
│                            GroupForm, FriendForm, ExpenseList, Avatar, PageHeader/EmptyState
└── pages/                ← Dashboard, GroupPage, FriendPage, AllExpensesPage, ActivityPage, SettingsPage
```

### Domain model: things to know before you change anything

- **Money is integer minor units.** Use `parseAmount` / `formatMoney`. Never store floats.
- **Payments are expenses** with `kind: 'payment'`. A payment from A to B is `paidBy: [A]`, `owedBy: [B]`, so the balance maths needs no special case.
- **Every split must sum exactly to `amount`.** `splitEqually` and `splitByWeights` hand out leftover minor units deterministically. Keep that invariant.
- `splitInputs` keeps the raw form input (percent/shares/exact/included) only so an expense can be re-edited. Balances come from `paidBy` / `owedBy`.
- **Single source of balances:** `allTransfers(groups, expenses)` returns outstanding debts tagged with `groupId`. Groups with `simplifyDebts` use the greedy minimiser; non-group expenses and other groups use pairwise who-paid-for-whom. `ledgerFromTransfers` turns that into `balanceBetween(ledger, a, b)`, where a positive value means b owes a. The dashboard, friend pages, group pages and settle-up hints all read from this, so they always agree.
- A non-group payment settles the **overall** friend balance but not per-group balances. This matches real Splitwise.
- Members with expenses in a group can't be removed from it. Friends with any expenses can't be deleted. This keeps the stored data consistent.
- **Schema changes:** bump `version` in `AppData` and the storage key, and add a migration in `storage.ts`. Users' data lives only in their browser, so never break old data silently.

### Conventions

- TypeScript `strict` with `noUnusedLocals`/`noUnusedParameters`. `verbatimModuleSyntax` is on, so use `import type` for type-only imports.
- State changes go through `dispatch(action)` in `AppStore.tsx`. Components don't write to localStorage.
- Pronouns in UI copy: `nameOf(ME)` gives "You" (subject) and `nameOf(ME, true)` gives "you" (object). Pick the right verb form too ("You owe" vs "Priya owes").
- Colours: `.lent` (teal-green) means money coming to the current user, `.borrowed` (orange) means money they owe, `.neutral`/`.muted` means everything else.
- Run `npm test && npm run build` in `splitwise/` before committing. Add or extend tests in `lib/*.test.ts` when touching split or balance logic.
