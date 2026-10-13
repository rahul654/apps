import type { AppData, ReferrerOption, Sandbox, Viewport } from '../types';
import { DEFAULT_VIEWPORT, defaultName } from './defaults';
import { orderFeatures, orderTokens, REFERRERS } from './policy';
import { clampSize, VIEWPORT_PRESETS } from './viewports';

/** Bump the version (and this key) with a migration if the shape of `AppData` changes. */
export const STORAGE_KEY = 'sandbox:data:v1';

export const emptyData = (): AppData => ({ version: 1, sandboxes: [] });

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, fallback = '') => (typeof x === 'string' ? x : fallback);
const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

function normalizeViewport(x: unknown): Viewport {
  const v = isRec(x) ? x : {};
  const preset = str(v.preset, DEFAULT_VIEWPORT.preset);
  return {
    preset: VIEWPORT_PRESETS.some((p) => p.id === preset) ? preset : DEFAULT_VIEWPORT.preset,
    width: clampSize(num(v.width, DEFAULT_VIEWPORT.width)),
    height: clampSize(num(v.height, DEFAULT_VIEWPORT.height)),
    landscape: bool(v.landscape, false),
    fit: bool(v.fit, true),
  };
}

/** Validates one stored sandbox, filling defaults. Returns null for unusable entries. */
export function normalizeSandbox(x: unknown): Sandbox | null {
  if (!isRec(x) || typeof x.id !== 'string' || !x.id) return null;
  const kind = x.kind === 'html' ? 'html' : x.kind === 'web' ? 'web' : null;
  if (!kind) return null;
  const url = str(x.url);
  const referrer = REFERRERS.some((r) => r.value === x.referrer) ? (x.referrer as ReferrerOption) : 'no-referrer';
  const now = Date.now();
  return {
    id: x.id,
    name: str(x.name).trim() || defaultName(kind, url),
    autoName: bool(x.autoName, false),
    kind,
    url: kind === 'web' && /^https?:\/\//i.test(url) ? url : '',
    html: str(x.html),
    autoRun: bool(x.autoRun, true),
    tokens: orderTokens(strs(x.tokens)),
    features: orderFeatures(strs(x.features)),
    referrer,
    credentialless: bool(x.credentialless, false),
    viewport: normalizeViewport(x.viewport),
    createdAt: num(x.createdAt, now),
    updatedAt: num(x.updatedAt, now),
  };
}

export function parseData(raw: string | null): AppData {
  if (!raw) return emptyData();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyData();
  }
  if (!isRec(parsed) || parsed.version !== 1 || !Array.isArray(parsed.sandboxes)) return emptyData();
  const seen = new Set<string>();
  const sandboxes: Sandbox[] = [];
  for (const item of parsed.sandboxes) {
    const sb = normalizeSandbox(item);
    if (sb && !seen.has(sb.id)) {
      seen.add(sb.id);
      sandboxes.push(sb);
    }
  }
  return { version: 1, sandboxes };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked site data
  }
}

export function loadData(): AppData {
  try {
    return parseData(storage()?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return emptyData();
  }
}

/** Returns false when the write failed (quota, blocked storage). */
export function saveData(data: AppData): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
