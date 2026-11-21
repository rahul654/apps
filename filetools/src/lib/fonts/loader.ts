/**
 * On-demand loading of bundled fonts (browser). Each variant is fetched once, parsed
 * with fontkit (for measuring, glyph coverage and PDF embedding) and registered as a
 * FontFace (for the screen and canvas). Font files are separate hashed assets.
 */
import type { Font as FontkitFont } from '@pdf-lib/fontkit';
import { fontDef, FONT_FAMILIES, resolveVariant, unicodeEquivalent, type FontId, type VariantKey } from './registry';

// URL strings only — no font bytes are bundled into JS.
const URLS = import.meta.glob('../../assets/fonts/*/*.{ttf,txt}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export function assetUrl(file: string): string | undefined {
  return URLS[`../../assets/fonts/${file}`];
}

export interface LoadedFont {
  bytes: Uint8Array;
  fk: FontkitFont;
}

type FontkitModule = { create(bytes: Uint8Array): FontkitFont };
let fontkitPromise: Promise<FontkitModule> | null = null;

/** The fontkit module (~700 kB), loaded the first time a bundled font is needed. */
export function getFontkit(): Promise<FontkitModule> {
  fontkitPromise ??= import('@pdf-lib/fontkit').then((m) => (m as unknown as { default: FontkitModule }).default ?? (m as unknown as FontkitModule));
  return fontkitPromise;
}

const pending = new Map<string, Promise<LoadedFont>>();
const ready = new Map<string, LoadedFont>();
const failed = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

const key = (font: FontId, variant: VariantKey) => `${font}|${variant}`;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribeFonts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function fontsVersion(): number {
  return version;
}

export function getLoadedFont(font: FontId, variant: VariantKey): LoadedFont | undefined {
  return ready.get(key(font, variant));
}

export function fontLoadError(font: FontId, variant: VariantKey): string | undefined {
  return failed.get(key(font, variant));
}

const bytesPending = new Map<string, Promise<Uint8Array>>();
const facePending = new Map<string, Promise<void>>();

function fetchBytes(font: FontId, variant: VariantKey): Promise<Uint8Array> {
  const k = key(font, variant);
  let p = bytesPending.get(k);
  if (!p) {
    const def = fontDef(font);
    const file = def.files[variant];
    p = (async () => {
      if (def.kind !== 'bundled' || !file) throw new Error(`${def.label} has no ${variant} style.`);
      const url = assetUrl(file);
      if (!url) throw new Error(`Font file missing from the build: ${file}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn’t download ${def.label} (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    })();
    p.catch(() => bytesPending.delete(k));
    bytesPending.set(k, p);
  }
  return p;
}

/** Register the FontFace only (screen/canvas), without parsing the font — e.g. for the signature pad. */
export function loadFace(font: FontId, variant: VariantKey): Promise<void> {
  const k = key(font, variant);
  let p = facePending.get(k);
  if (!p) {
    p = (async () => {
      const bytes = await fetchBytes(font, variant);
      if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
      const face = new FontFace(fontDef(font).cssFamily, bytes.slice().buffer, {
        weight: variant === 'bold' || variant === 'boldItalic' ? '700' : '400',
        style: variant === 'italic' || variant === 'boldItalic' ? 'italic' : 'normal',
      });
      await face.load();
      document.fonts.add(face);
    })();
    p.catch(() => facePending.delete(k));
    facePending.set(k, p);
  }
  return p;
}

/** Fetch, register for the screen and parse with fontkit (for measuring, coverage and embedding). */
export function loadFont(font: FontId, variant: VariantKey): Promise<LoadedFont> {
  const k = key(font, variant);
  const existing = pending.get(k);
  if (existing) return existing;
  const p = (async () => {
    const [bytes, fkModule] = await Promise.all([fetchBytes(font, variant), getFontkit(), loadFace(font, variant)]);
    const loaded = { bytes, fk: fkModule.create(bytes) };
    ready.set(k, loaded);
    failed.delete(k);
    notify();
    return loaded;
  })();
  p.catch((e: unknown) => {
    failed.set(k, String((e as Error)?.message ?? e));
    pending.delete(k);
    notify();
  });
  pending.set(k, p);
  return p;
}

/** Load what a set of runs needs: their own variants, plus the Unicode substitute for standard fonts if `unicode`. */
export function ensureFontsFor(runs: { font: FontId; bold: boolean; italic: boolean; unicode?: boolean }[]): Promise<unknown> {
  const jobs: Promise<unknown>[] = [];
  for (const r of runs) {
    const ids = new Set<FontId>([r.font]);
    if (r.unicode) ids.add(unicodeEquivalent(r.font));
    for (const id of ids) {
      if (fontDef(id).kind !== 'bundled') continue;
      const v = resolveVariant(id, r.bold, r.italic).key;
      if (!ready.has(key(id, v)) && !failed.has(key(id, v))) jobs.push(loadFont(id, v).catch(() => undefined));
    }
  }
  return Promise.all(jobs);
}

/** Licence files (OFL) of bundled families, as URLs. */
export function licenceLinks(): { label: string; url: string }[] {
  return FONT_FAMILIES.filter((f) => f.licenseFile && assetUrl(f.licenseFile)).map((f) => ({ label: f.label, url: assetUrl(f.licenseFile!)! }));
}
