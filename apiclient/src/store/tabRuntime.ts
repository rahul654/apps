/**
 * In-memory state of open tabs that is not saved: the last response, whether a send is running
 * (with its AbortController) and which section was showing. Only the active tab's editor is
 * mounted, so this lives outside React: switching tabs and back keeps the response, and a send
 * that finishes while another tab is shown still lands in its own tab. Keyed by `ws\0tabId`.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { ExecResult } from '../lib/execute';

export interface TabRuntime {
  result: ExecResult | null;
  sending: boolean;
  abort: AbortController | null;
  /** Request-editor section (params, headers, body, …). */
  section: string | null;
}

const EMPTY: TabRuntime = { result: null, sending: false, abort: null, section: null };
const map = new Map<string, TabRuntime>();
const listeners = new Map<string, Set<() => void>>();

export const runtimeKey = (ws: string, tabId: string): string => `${ws}\u0000${tabId}`;

export function getRuntime(key: string): TabRuntime {
  return map.get(key) ?? EMPTY;
}

function emit(key: string) {
  for (const l of listeners.get(key) ?? []) l();
}

export function updateRuntime(key: string, patch: Partial<TabRuntime>): void {
  map.set(key, { ...getRuntime(key), ...patch });
  emit(key);
}

/** A closed tab forgets its response (a running send is cancelled). */
export function dropRuntime(key: string): void {
  map.get(key)?.abort?.abort();
  map.delete(key);
  emit(key);
}

/** A new request saved into a collection keeps its response under the new tab id. */
export function moveRuntime(from: string, to: string): void {
  const r = map.get(from);
  if (!r) return;
  map.delete(from);
  map.set(to, r);
  emit(from);
  emit(to);
}

export function useTabRuntime(key: string): [TabRuntime, (patch: Partial<TabRuntime>) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(subscribe, () => getRuntime(key));
  const update = useCallback((patch: Partial<TabRuntime>) => updateRuntime(key, patch), [key]);
  return [value, update];
}
