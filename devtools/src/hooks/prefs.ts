// Harmless UI preferences only (theme, indent size, last tools…). Tool INPUTS are never stored.
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'devtools:prefs:v1';
type Prefs = Record<string, unknown>;

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Prefs) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable (private mode); keep in memory */
  }
  listeners.forEach((l) => l());
}

export function getPref<T>(key: string, fallback: T): T {
  const v = read()[key];
  return v === undefined ? fallback : (v as T);
}

export function setPref(key: string, value: unknown) {
  write({ ...read(), [key]: value });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      cache = null;
      listeners.forEach((l) => l());
    }
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Persisted preference. `validate` guards against stale or tampered values. */
export function usePref<T>(key: string, fallback: T, validate?: (v: unknown) => boolean): [T, (v: T) => void] {
  const snapshot = () => read()[key];
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
  const value = raw === undefined || (validate && !validate(raw)) ? fallback : (raw as T);
  const set = useCallback((v: T) => setPref(key, v), [key]);
  return [value, set];
}

export const oneOf =
  (...allowed: unknown[]) =>
  (v: unknown) =>
    allowed.includes(v);
