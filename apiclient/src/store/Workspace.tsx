/**
 * Workspace state: collections, environments, globals, history, runs and prefs. Loaded from
 * IndexedDB once, then every action is applied in memory and written through to the store.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openStore, STORES, type Store } from '../lib/db';
import { uuid } from '../lib/id';
import { collectionId } from '../lib/postman/normalize';
import type { PmCollection, PmEnvironmentFile } from '../lib/postman/types';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import type { RunReport } from '../lib/runner/runner';
import type { MergeResult } from '../lib/workspace/zip';
import type { CollectionRecord, HistoryEntry } from '../types';

export interface WorkspaceState {
  ready: boolean;
  loadError: string | null;
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile;
  activeEnvironmentId: string | null;
  history: HistoryEntry[];
  runs: RunReport[];
  prefs: Prefs;
}

export type Action =
  | { type: 'load'; data: Partial<WorkspaceState> }
  | { type: 'collection/put'; collection: PmCollection }
  | { type: 'collection/remove'; id: string }
  | { type: 'environment/put'; env: PmEnvironmentFile }
  | { type: 'environment/remove'; id: string }
  | { type: 'environment/active'; id: string | null }
  | { type: 'globals/set'; globals: PmEnvironmentFile }
  | { type: 'history/add'; entry: HistoryEntry }
  | { type: 'history/remove'; id: string }
  | { type: 'history/clear' }
  | { type: 'run/put'; run: RunReport }
  | { type: 'run/remove'; id: string }
  | { type: 'prefs/set'; prefs: Prefs }
  | { type: 'replaceAll'; data: MergeResult }
  | { type: 'wipe' };

export const EMPTY_GLOBALS: PmEnvironmentFile = { id: 'globals', name: 'Globals', values: [], _postman_variable_scope: 'globals' };

export const initialState = (): WorkspaceState => ({ ready: false, loadError: null, collections: [], environments: [], globals: EMPTY_GLOBALS, activeEnvironmentId: null, history: [], runs: [], prefs: DEFAULT_PREFS });

export function reducer(s: WorkspaceState, a: Action): WorkspaceState {
  switch (a.type) {
    case 'load':
      return { ...s, ...a.data, ready: true };
    case 'collection/put': {
      const id = collectionId(a.collection);
      const i = s.collections.findIndex((c) => collectionId(c) === id);
      const collections = i >= 0 ? s.collections.map((c, j) => (j === i ? a.collection : c)) : [...s.collections, a.collection];
      return { ...s, collections };
    }
    case 'collection/remove':
      return { ...s, collections: s.collections.filter((c) => collectionId(c) !== a.id) };
    case 'environment/put': {
      const i = s.environments.findIndex((e) => e.id === a.env.id);
      return { ...s, environments: i >= 0 ? s.environments.map((e, j) => (j === i ? a.env : e)) : [...s.environments, a.env] };
    }
    case 'environment/remove':
      return { ...s, environments: s.environments.filter((e) => e.id !== a.id), activeEnvironmentId: s.activeEnvironmentId === a.id ? null : s.activeEnvironmentId };
    case 'environment/active':
      return { ...s, activeEnvironmentId: a.id };
    case 'globals/set':
      return { ...s, globals: { ...a.globals, id: 'globals', _postman_variable_scope: 'globals' } };
    case 'history/add':
      return { ...s, history: [a.entry, ...s.history].slice(0, s.prefs.historyLimit) };
    case 'history/remove':
      return { ...s, history: s.history.filter((h) => h.id !== a.id) };
    case 'history/clear':
      return { ...s, history: [] };
    case 'run/put': {
      const i = s.runs.findIndex((r) => r.id === a.run.id);
      return { ...s, runs: i >= 0 ? s.runs.map((r, j) => (j === i ? a.run : r)) : [a.run, ...s.runs] };
    }
    case 'run/remove':
      return { ...s, runs: s.runs.filter((r) => r.id !== a.id) };
    case 'prefs/set':
      return { ...s, prefs: a.prefs };
    case 'replaceAll':
      return { ...s, collections: a.data.collections, environments: a.data.environments, globals: { ...a.data.globals, id: 'globals', _postman_variable_scope: 'globals' }, history: a.data.history.slice(0, s.prefs.historyLimit), runs: a.data.runs, activeEnvironmentId: a.data.activeEnvironmentId };
    case 'wipe':
      return { ...initialState(), ready: true, prefs: s.prefs };
  }
}

/** Writes the effect of an action to IndexedDB. Errors are logged; the in-memory state stays authoritative. */
async function persist(store: Store, a: Action, prev: WorkspaceState, next: WorkspaceState): Promise<void> {
  const now = new Date().toISOString();
  switch (a.type) {
    case 'collection/put':
      return store.put(STORES.collections, { id: collectionId(a.collection), data: a.collection, updatedAt: now } satisfies CollectionRecord);
    case 'collection/remove':
      return store.delete(STORES.collections, a.id);
    case 'environment/put':
      return store.put(STORES.environments, a.env);
    case 'environment/remove':
      await store.delete(STORES.environments, a.id);
      if (prev.activeEnvironmentId === a.id) await store.kvSet('activeEnvironmentId', null);
      return;
    case 'environment/active':
      return store.kvSet('activeEnvironmentId', a.id);
    case 'globals/set':
      return store.kvSet('globals', next.globals);
    case 'history/add': {
      await store.put(STORES.history, a.entry);
      const keep = new Set(next.history.map((h) => h.id));
      for (const h of prev.history) if (!keep.has(h.id)) await store.delete(STORES.history, h.id);
      return;
    }
    case 'history/remove':
      return store.delete(STORES.history, a.id);
    case 'history/clear':
      return store.clear(STORES.history);
    case 'run/put':
      return store.put(STORES.runs, a.run);
    case 'run/remove':
      return store.delete(STORES.runs, a.id);
    case 'prefs/set':
      savePrefs(a.prefs);
      return;
    case 'replaceAll':
      await store.clearAll();
      await store.putMany(STORES.collections, next.collections.map((c) => ({ id: collectionId(c), data: c, updatedAt: now }) satisfies CollectionRecord));
      await store.putMany(STORES.environments, next.environments);
      await store.putMany(STORES.history, next.history);
      await store.putMany(STORES.runs, next.runs);
      await store.kvSet('globals', next.globals);
      await store.kvSet('activeEnvironmentId', next.activeEnvironmentId);
      return;
    case 'wipe':
      return store.clearAll();
    case 'load':
      return;
  }
}

export async function loadAll(store: Store): Promise<Partial<WorkspaceState>> {
  const [cols, envs, history, runs, globals, active] = await Promise.all([
    store.getAll<CollectionRecord>(STORES.collections),
    store.getAll<PmEnvironmentFile>(STORES.environments),
    store.getAll<HistoryEntry>(STORES.history),
    store.getAll<RunReport>(STORES.runs),
    store.kvGet<PmEnvironmentFile>('globals'),
    store.kvGet<string | null>('activeEnvironmentId'),
  ]);
  return {
    collections: cols.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map((c) => c.data),
    environments: envs.sort((a, b) => a.name.localeCompare(b.name)),
    history: history.sort((a, b) => b.at.localeCompare(a.at)),
    runs: runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    globals: globals ?? EMPTY_GLOBALS,
    activeEnvironmentId: active && envs.some((e) => e.id === active) ? active : null,
    prefs: loadPrefs(),
  };
}

interface Ctx {
  state: WorkspaceState;
  dispatch: (a: Action) => void;
  /** Request drafts (unsaved edits) by item id, kept while navigating. */
  drafts: Map<string, unknown>;
  bump: () => void;
  /** Increments on every draft edit. */
  draftVersion: number;
}

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children, initial, storeFactory }: { children: ReactNode; initial?: Partial<WorkspaceState>; storeFactory?: () => Promise<Store> }) {
  const [state, setState] = useState<WorkspaceState>(() => (initial ? { ...initialState(), ...initial, ready: true } : initialState()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const storeRef = useRef<Store | null>(null);
  // Actions dispatched before IndexedDB is open are written once it is.
  const queueRef = useRef<{ a: Action; prev: WorkspaceState; next: WorkspaceState }[]>([]);
  const drafts = useRef(new Map<string, unknown>()).current;
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const open = storeFactory ?? (initial ? null : () => openStore());
    if (!open) return;
    open()
      .then(async (store) => {
        if (cancelled) return;
        if (!initial) {
          const data = await loadAll(store);
          if (!cancelled) setState((s) => reducer(s, { type: 'load', data }));
        }
        storeRef.current = store;
        const queued = queueRef.current.splice(0);
        for (const q of queued) await persist(store, q.a, q.prev, q.next).catch((e: unknown) => console.error('Could not save to IndexedDB', e));
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, ready: true, loadError: e instanceof Error ? e.message : String(e), prefs: loadPrefs() }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatch = useCallback((a: Action) => {
    const prev = stateRef.current;
    const next = reducer(prev, a);
    stateRef.current = next;
    setState(next);
    const store = storeRef.current;
    if (store) persist(store, a, prev, next).catch((e: unknown) => console.error('Could not save to IndexedDB', e));
    else queueRef.current.push({ a, prev, next });
  }, []);

  // `tick` is a dependency on purpose: draft edits live in the mutable map and must re-render consumers.
  const value = useMemo<Ctx>(() => ({ state, dispatch, drafts, bump, draftVersion: tick }), [state, dispatch, drafts, bump, tick]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider');
  return ctx;
}

export function newCollection(name: string): PmCollection {
  return { info: { _postman_id: uuid(), name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] };
}

export function newEnvironment(name: string): PmEnvironmentFile {
  return { id: uuid(), name, values: [], _postman_variable_scope: 'environment' };
}
