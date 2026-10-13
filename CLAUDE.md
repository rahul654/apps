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
└── filetools/                 ← PDF / image / QR tools, all client-side
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
| `devtools/`, `filetools/` | same `dev` / `test` / `build` scripts | Each app is self-contained |

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
- Image encoding runs in an OffscreenCanvas worker pool with a main-thread fallback. Output formats are feature-detected (`canvas.toBlob`), and EXIF orientation is applied before metadata is stripped.
- `DropZone` keeps its hidden `<input type=file>` *outside* the clickable zone. A programmatic `click()` inside it would bubble back to the zone's `onClick`.

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
