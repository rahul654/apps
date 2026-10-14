import { normalizeHex } from './color';
import type { ExportFormat } from './format';
import { DEFAULT_MODEL, isModelId, type ModelId } from './models';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'bgremover:theme';
/** Bump the version (and this key) with a migration if the shape of `Prefs` changes. */
export const PREFS_KEY = 'bgremover:prefs:v1';

export function getTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: ThemeChoice): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* preference just won't persist */
  }
}

export type BackgroundKind = 'transparent' | 'color' | 'blur' | 'image';

export interface Prefs {
  model: ModelId;
  background: BackgroundKind;
  color: string;
  /** Blur radius as a percentage of the image's longer side (0.2–8). */
  blur: number;
  shadow: boolean;
  /** Shadow opacity 0–1. */
  shadowOpacity: number;
  /** Shadow blur and downward offset as a percentage of the image's longer side. */
  shadowBlur: number;
  shadowOffset: number;
  format: ExportFormat;
  /** 0.5–1 for WebP/JPEG. */
  quality: number;
  crop: boolean;
  /** Padding around the subject, % of its larger side. */
  padding: number;
  /** Brush diameter in screen pixels. */
  brushSize: number;
}

export const DEFAULT_PREFS: Prefs = {
  model: DEFAULT_MODEL,
  background: 'transparent',
  color: '#ffffff',
  blur: 2,
  shadow: false,
  shadowOpacity: 0.35,
  shadowBlur: 2,
  shadowOffset: 1,
  format: 'png',
  quality: 0.92,
  crop: false,
  padding: 5,
  brushSize: 40,
};

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const oneOf = <T extends string>(x: unknown, opts: readonly T[], fallback: T): T => (opts.includes(x as T) ? (x as T) : fallback);

/** Validates stored prefs, filling defaults for anything missing or out of range. */
export function normalizePrefs(x: unknown): Prefs {
  const p = isRec(x) ? x : {};
  const d = DEFAULT_PREFS;
  return {
    model: isModelId(p.model) ? p.model : d.model,
    // A custom background image isn't persisted, so never restore 'image'.
    background: oneOf(p.background, ['transparent', 'color', 'blur'] as const, d.background),
    color: typeof p.color === 'string' ? normalizeHex(p.color, d.color) : d.color,
    blur: num(p.blur, d.blur, 0.2, 8),
    shadow: typeof p.shadow === 'boolean' ? p.shadow : d.shadow,
    shadowOpacity: num(p.shadowOpacity, d.shadowOpacity, 0, 1),
    shadowBlur: num(p.shadowBlur, d.shadowBlur, 0, 10),
    shadowOffset: num(p.shadowOffset, d.shadowOffset, -10, 10),
    format: oneOf(p.format, ['png', 'webp', 'jpeg'] as const, d.format),
    quality: num(p.quality, d.quality, 0.5, 1),
    crop: typeof p.crop === 'boolean' ? p.crop : d.crop,
    padding: num(p.padding, d.padding, 0, 50),
    brushSize: num(p.brushSize, d.brushSize, 4, 300),
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return normalizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* quota or private mode: preferences just won't persist */
  }
}
