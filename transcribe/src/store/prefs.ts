import { useSyncExternalStore } from 'react';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';

let prefs: Prefs | null = null;
const listeners = new Set<() => void>();
const get = () => (prefs ??= loadPrefs());

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...get(), ...patch };
  savePrefs(prefs);
  for (const fn of listeners) fn();
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const p = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get,
    get,
  );
  return [p, setPrefs];
}

/** Tests: forget the cached prefs so the next read comes from localStorage. */
export function resetPrefsCache(): void {
  prefs = null;
}
