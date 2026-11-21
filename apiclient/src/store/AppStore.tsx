/**
 * App data: every workspace (collections, environments, globals, active environment, history,
 * runs) plus app-wide prefs. Loaded from IndexedDB once; every action is applied in memory and
 * written through to the store.
 *
 * Pages read `state` = app state + the ACTIVE workspace's data, so they only ever see the current
 * workspace. Data actions carry the workspace they belong to (`ws`): dispatch fills in the active
 * one, and async work (sending, the runner) passes the workspace it started in, so a result that
 * arrives after a switch still lands in the right place.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openStore, STORES, wsRange, type Store, type TabsRow, type WorkspaceRecord, type WsRow } from '../lib/db';
import { uuid } from '../lib/id';
import { collectionId } from '../lib/postman/normalize';
import { isPristineNew } from '../lib/postman/edit';
import type { PmCollection, PmEnvironmentFile, PmItem } from '../lib/postman/types';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import type { RunReport } from '../lib/runner/runner';
import { EMPTY_TABS, pinTab, sanitizeTabs, type TabsState } from '../lib/tabs';
import type { ImportOp } from '../lib/workspace/importPlan';
import { cleanWorkspaceName, DEFAULT_WORKSPACE_ID, defaultWorkspaceMeta, EMPTY_GLOBALS, emptyWorkspaceData, isDefaultWorkspace, sortWorkspaces, uniqueWorkspaceName, type WorkspaceData, type WorkspaceMeta } from '../lib/workspaces';
import type { HistoryEntry } from '../types';

export { EMPTY_GLOBALS };

export interface AppState {
  ready: boolean;
  loadError: string | null;
  /** App-wide; `prefs.activeWorkspaceId` is the workspace every page shows. */
  prefs: Prefs;
  workspaces: WorkspaceMeta[];
  data: Record<string, WorkspaceData>;
  /** Open request tabs per workspace (persisted in the `tabs` store). */
  session: Record<string, TabsState>;
}

/** What pages read: app state plus the active workspace's data and tabs. */
export type AppView = AppState & WorkspaceData & { workspace: WorkspaceMeta; activeWorkspaceId: string; tabs: TabsState };

type DataActionBase =
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
  | { type: 'run/remove'; id: string };
/** Changes inside one workspace; `ws` defaults to the active workspace at dispatch time. */
export type DataAction = DataActionBase & { ws?: string };

export type Action =
  | DataAction
  | { type: 'load'; data: Pick<AppState, 'workspaces' | 'data' | 'prefs'> & { session?: Record<string, TabsState> } }
  | { type: 'tabs/set'; ws: string; tabs: TabsState }
  | { type: 'prefs/set'; prefs: Prefs }
  | { type: 'workspace/create'; meta: WorkspaceMeta; data?: WorkspaceData; activate?: boolean }
  | { type: 'workspace/rename'; id: string; name: string }
  | { type: 'workspace/remove'; id: string }
  | { type: 'workspace/switch'; id: string }
  | { type: 'import/apply'; ops: ImportOp[] }
  | { type: 'wipe' };

const DATA_ACTIONS = new Set<string>(['collection/put', 'collection/remove', 'environment/put', 'environment/remove', 'environment/active', 'globals/set', 'history/add', 'history/remove', 'history/clear', 'run/put', 'run/remove']);
export const isDataAction = (a: Action): a is DataAction => DATA_ACTIONS.has(a.type);

export function initialState(): AppState {
  return { ready: false, loadError: null, prefs: DEFAULT_PREFS, workspaces: [defaultWorkspaceMeta()], data: { [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData() }, session: {} };
}

/** Test/seed input: either full app data, or one workspace's data that goes into Default. */
export type InitialData = Partial<WorkspaceData> & { workspaces?: WorkspaceMeta[]; data?: Record<string, WorkspaceData>; prefs?: Partial<Prefs>; session?: Record<string, TabsState>; drafts?: Record<string, Record<string, unknown>> };

export function stateFromInitial(init: InitialData): AppState {
  const base = initialState();
  const { workspaces, data, prefs, session, drafts: _drafts, ...one } = init;
  const s: AppState = workspaces
    ? { ...base, workspaces: sortWorkspaces(workspaces), data: { ...Object.fromEntries(workspaces.map((w) => [w.id, emptyWorkspaceData()])), ...data } }
    : { ...base, data: { [DEFAULT_WORKSPACE_ID]: { ...emptyWorkspaceData(), ...one } } };
  return withValidActive({ ...s, ready: true, prefs: { ...base.prefs, ...prefs }, session: session ?? {} });
}

function withValidActive(s: AppState): AppState {
  if (!s.workspaces.some(isDefaultWorkspace)) s = { ...s, workspaces: sortWorkspaces([defaultWorkspaceMeta(), ...s.workspaces]), data: { [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData(), ...s.data } };
  return s.workspaces.some((w) => w.id === s.prefs.activeWorkspaceId) ? s : { ...s, prefs: { ...s.prefs, activeWorkspaceId: DEFAULT_WORKSPACE_ID } };
}

export function viewOf(s: AppState): AppView {
  const workspace = s.workspaces.find((w) => w.id === s.prefs.activeWorkspaceId) ?? s.workspaces.find(isDefaultWorkspace) ?? defaultWorkspaceMeta();
  return { ...s, ...(s.data[workspace.id] ?? emptyWorkspaceData()), workspace, activeWorkspaceId: workspace.id, tabs: s.session[workspace.id] ?? EMPTY_TABS };
}

const trimHistory = (d: WorkspaceData, limit: number): WorkspaceData => (d.history.length > limit ? { ...d, history: d.history.slice(0, limit) } : d);

/** One workspace's data under a data action. */
export function dataReducer(d: WorkspaceData, a: DataActionBase, historyLimit: number): WorkspaceData {
  switch (a.type) {
    case 'collection/put': {
      const id = collectionId(a.collection);
      const i = d.collections.findIndex((c) => collectionId(c) === id);
      return { ...d, collections: i >= 0 ? d.collections.map((c, j) => (j === i ? a.collection : c)) : [...d.collections, a.collection] };
    }
    case 'collection/remove':
      return { ...d, collections: d.collections.filter((c) => collectionId(c) !== a.id) };
    case 'environment/put': {
      const i = d.environments.findIndex((e) => e.id === a.env.id);
      return { ...d, environments: i >= 0 ? d.environments.map((e, j) => (j === i ? a.env : e)) : [...d.environments, a.env] };
    }
    case 'environment/remove':
      return { ...d, environments: d.environments.filter((e) => e.id !== a.id), activeEnvironmentId: d.activeEnvironmentId === a.id ? null : d.activeEnvironmentId };
    case 'environment/active':
      return { ...d, activeEnvironmentId: a.id };
    case 'globals/set':
      return { ...d, globals: { ...a.globals, id: 'globals', _postman_variable_scope: 'globals' } };
    case 'history/add':
      return { ...d, history: [a.entry, ...d.history].slice(0, historyLimit) };
    case 'history/remove':
      return { ...d, history: d.history.filter((h) => h.id !== a.id) };
    case 'history/clear':
      return { ...d, history: [] };
    case 'run/put': {
      const i = d.runs.findIndex((r) => r.id === a.run.id);
      return { ...d, runs: i >= 0 ? d.runs.map((r, j) => (j === i ? a.run : r)) : [a.run, ...d.runs] };
    }
    case 'run/remove':
      return { ...d, runs: d.runs.filter((r) => r.id !== a.id) };
  }
}

export function reducer(s: AppState, a: Action): AppState {
  if (isDataAction(a)) {
    const ws = a.ws ?? s.prefs.activeWorkspaceId;
    const d = s.data[ws];
    if (!d) return s; // the workspace was deleted while the work was in flight
    return { ...s, data: { ...s.data, [ws]: dataReducer(d, a, s.prefs.historyLimit) } };
  }
  const now = new Date().toISOString();
  switch (a.type) {
    case 'load':
      return withValidActive({ ...s, ...a.data, session: a.data.session ?? s.session, ready: true });
    case 'tabs/set':
      if (!s.data[a.ws] || s.session[a.ws] === a.tabs) return s;
      return { ...s, session: { ...s.session, [a.ws]: a.tabs } };
    case 'prefs/set':
      return { ...s, prefs: { ...a.prefs, activeWorkspaceId: s.prefs.activeWorkspaceId } };
    case 'workspace/create': {
      const name = uniqueWorkspaceName(a.meta.name, s.workspaces, a.meta.id);
      const meta: WorkspaceMeta = { ...a.meta, name };
      return {
        ...s,
        workspaces: sortWorkspaces([...s.workspaces.filter((w) => w.id !== meta.id), meta]),
        data: { ...s.data, [meta.id]: trimHistory(a.data ?? emptyWorkspaceData(), s.prefs.historyLimit) },
        prefs: a.activate ? { ...s.prefs, activeWorkspaceId: meta.id } : s.prefs,
      };
    }
    case 'workspace/rename': {
      const w = s.workspaces.find((x) => x.id === a.id);
      if (!w || !cleanWorkspaceName(a.name)) return s;
      const name = uniqueWorkspaceName(a.name, s.workspaces, a.id);
      return name === w.name ? s : { ...s, workspaces: s.workspaces.map((x) => (x.id === a.id ? { ...x, name, updatedAt: now } : x)) };
    }
    case 'workspace/remove': {
      const w = s.workspaces.find((x) => x.id === a.id);
      if (!w || isDefaultWorkspace(w)) return s;
      const data = { ...s.data };
      delete data[a.id];
      const session = { ...s.session };
      delete session[a.id];
      return { ...s, workspaces: s.workspaces.filter((x) => x.id !== a.id), data, session, prefs: s.prefs.activeWorkspaceId === a.id ? { ...s.prefs, activeWorkspaceId: DEFAULT_WORKSPACE_ID } : s.prefs };
    }
    case 'workspace/switch':
      return s.workspaces.some((w) => w.id === a.id) && s.prefs.activeWorkspaceId !== a.id ? { ...s, prefs: { ...s.prefs, activeWorkspaceId: a.id } } : s;
    case 'import/apply': {
      let workspaces = s.workspaces;
      const data = { ...s.data };
      for (const op of a.ops) {
        if (op.create && !workspaces.some((w) => w.id === op.ws)) workspaces = [...workspaces, { ...op.create, name: uniqueWorkspaceName(op.create.name, workspaces) }];
        else if (op.rename) workspaces = workspaces.map((w) => (w.id === op.ws ? { ...w, name: uniqueWorkspaceName(op.rename!, workspaces, op.ws), updatedAt: now } : w));
        data[op.ws] = trimHistory(op.data, s.prefs.historyLimit);
      }
      return { ...s, workspaces: sortWorkspaces(workspaces), data };
    }
    case 'wipe':
      return { ...s, workspaces: [defaultWorkspaceMeta(now)], data: { [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData() }, session: {}, prefs: { ...s.prefs, activeWorkspaceId: DEFAULT_WORKSPACE_ID } };
  }
}

export function recordOf(s: AppState, ws: string): WorkspaceRecord | null {
  const meta = s.workspaces.find((w) => w.id === ws);
  const d = s.data[ws];
  return meta && d ? { ...meta, globals: d.globals, activeEnvironmentId: d.activeEnvironmentId } : null;
}

/** Writes the effect of an action to IndexedDB. Errors are logged; the in-memory state stays authoritative. */
export async function persist(store: Store, a: Action, prev: AppState, next: AppState): Promise<void> {
  const now = new Date().toISOString();
  const putRecord = async (ws: string) => {
    const r = recordOf(next, ws);
    if (r) await store.put(STORES.workspaces, r);
  };
  const replace = async (ws: string) => {
    const r = recordOf(next, ws);
    if (r) await store.replaceWorkspace(r, next.data[ws]);
  };
  if (isDataAction(a)) {
    const ws = a.ws ?? prev.prefs.activeWorkspaceId;
    if (!next.data[ws]) return;
    switch (a.type) {
      case 'collection/put':
        return store.put(STORES.collections, { ws, id: collectionId(a.collection), data: a.collection, updatedAt: now } satisfies WsRow<PmCollection>);
      case 'collection/remove':
        return store.delete(STORES.collections, [ws, a.id]);
      case 'environment/put':
        return store.put(STORES.environments, { ws, id: a.env.id ?? '', data: a.env } satisfies WsRow<PmEnvironmentFile>);
      case 'environment/remove':
        await store.delete(STORES.environments, [ws, a.id]);
        if (prev.data[ws]?.activeEnvironmentId === a.id) await putRecord(ws);
        return;
      case 'environment/active':
      case 'globals/set':
        return putRecord(ws);
      case 'history/add': {
        await store.put(STORES.history, { ws, id: a.entry.id, data: a.entry } satisfies WsRow<HistoryEntry>);
        const keep = new Set(next.data[ws].history.map((h) => h.id));
        for (const h of prev.data[ws]?.history ?? []) if (!keep.has(h.id)) await store.delete(STORES.history, [ws, h.id]);
        return;
      }
      case 'history/remove':
        return store.delete(STORES.history, [ws, a.id]);
      case 'history/clear':
        return store.delete(STORES.history, wsRange(ws));
      case 'run/put':
        return store.put(STORES.runs, { ws, id: a.run.id, data: a.run } satisfies WsRow<RunReport>);
      case 'run/remove':
        return store.delete(STORES.runs, [ws, a.id]);
    }
    return;
  }
  if (next.prefs !== prev.prefs) savePrefs(next.prefs);
  switch (a.type) {
    case 'workspace/create':
      return replace(a.meta.id);
    case 'workspace/rename':
      return putRecord(a.id);
    case 'tabs/set':
      if (next.session[a.ws]) await store.put(STORES.tabs, { ws: a.ws, ...next.session[a.ws] } satisfies TabsRow);
      return;
    case 'workspace/remove':
      if (!next.data[a.id]) await store.deleteWorkspace(a.id);
      return;
    case 'import/apply':
      for (const op of a.ops) await replace(op.ws);
      return;
    case 'wipe':
      await store.clearAll();
      return replace(DEFAULT_WORKSPACE_ID);
    case 'load':
    case 'prefs/set':
    case 'workspace/switch':
      return;
  }
}

export type Loaded = Pick<AppState, 'workspaces' | 'data' | 'prefs' | 'session'> & { drafts: Record<string, Record<string, unknown>> };

/** Reads every workspace, its open tabs and drafts. Creates the Default record when it is missing (a fresh database). */
export async function loadAll(store: Store, prefs: Prefs = loadPrefs()): Promise<Loaded> {
  const [records, cols, envs, history, runs, tabRows, draftRows] = await Promise.all([
    store.getAll<WorkspaceRecord>(STORES.workspaces),
    store.getAll<WsRow<PmCollection>>(STORES.collections),
    store.getAll<WsRow<PmEnvironmentFile>>(STORES.environments),
    store.getAll<WsRow<HistoryEntry>>(STORES.history),
    store.getAll<WsRow<RunReport>>(STORES.runs),
    store.getAll<TabsRow>(STORES.tabs),
    store.getAll<WsRow<unknown>>(STORES.drafts),
  ]);
  if (!records.some(isDefaultWorkspace)) {
    const rec: WorkspaceRecord = { ...defaultWorkspaceMeta(), globals: EMPTY_GLOBALS, activeEnvironmentId: null };
    await store.put(STORES.workspaces, rec);
    records.push(rec);
  }
  const by = <T,>(rows: WsRow<T>[]) => {
    const m = new Map<string, WsRow<T>[]>();
    for (const r of rows) {
      const list = m.get(r.ws);
      if (list) list.push(r);
      else m.set(r.ws, [r]);
    }
    return m;
  };
  const [c, e, h, r] = [by(cols), by(envs), by(history), by(runs)];
  const data: Record<string, WorkspaceData> = {};
  const workspaces: WorkspaceMeta[] = [];
  for (const { globals, activeEnvironmentId, ...meta } of records) {
    workspaces.push(meta);
    const environments = (e.get(meta.id) ?? []).map((x) => x.data).sort((a, b) => a.name.localeCompare(b.name));
    data[meta.id] = {
      collections: (c.get(meta.id) ?? []).sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')).map((x) => x.data),
      environments,
      history: (h.get(meta.id) ?? []).map((x) => x.data).sort((a, b) => b.at.localeCompare(a.at)),
      runs: (r.get(meta.id) ?? []).map((x) => x.data).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      globals: globals ?? EMPTY_GLOBALS,
      activeEnvironmentId: activeEnvironmentId && environments.some((x) => x.id === activeEnvironmentId) ? activeEnvironmentId : null,
    };
  }
  const session: Record<string, TabsState> = {};
  for (const row of tabRows) if (data[row.ws]) session[row.ws] = sanitizeTabs(row);
  const drafts: Record<string, Record<string, unknown>> = {};
  for (const row of draftRows) if (data[row.ws] && row.data && typeof row.data === 'object') (drafts[row.ws] ??= {})[row.id] = row.data;
  return { workspaces: sortWorkspaces(workspaces), data, prefs, session, drafts };
}

interface Ctx {
  /** App state plus the active workspace's data and tabs. */
  state: AppView;
  dispatch: (a: Action) => void;
  /** The active workspace's drafts (unsaved tab edits) by tab id. Change them through `setDraft`. */
  drafts: ReadonlyMap<string, unknown>;
  /**
   * Sets a tab's draft, or removes it with `undefined`. Drafts are written to IndexedDB (debounced),
   * so they survive a reload. Editing a preview tab makes it permanent.
   */
  setDraft: (tabId: string, value: unknown, ws?: string) => void;
  /** Number of drafts kept for a workspace. */
  draftCount: (ws: string) => number;
  /** Increments on every draft change. */
  draftVersion: number;
  /** Updates a workspace's tabs (default: the active one) from the latest state. */
  setTabs: (fn: (t: TabsState) => TabsState, ws?: string) => void;
  /** The latest view, including changes dispatched since the last render (for several writes in a row). */
  getState: () => AppView;
}

const AppStoreContext = createContext<Ctx | null>(null);

/** How long draft edits wait before they are written (every keystroke would be a write otherwise). */
export const DRAFT_SAVE_DELAY = 300;

export function AppStoreProvider({ children, initial, storeFactory }: { children: ReactNode; initial?: InitialData; storeFactory?: () => Promise<Store> }) {
  const [state, setState] = useState<AppState>(() => (initial ? stateFromInitial(initial) : initialState()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const storeRef = useRef<Store | null>(null);
  // Writes queued before IndexedDB is open run once it is.
  const queueRef = useRef<((store: Store) => Promise<void>)[]>([]);
  // Writes run one after another, so a later change never lands before an earlier one.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((job: (store: Store) => Promise<void>) => {
    const store = storeRef.current;
    if (!store) {
      queueRef.current.push(job);
      return;
    }
    chainRef.current = chainRef.current.then(() => job(store)).catch((e: unknown) => console.error('Could not save to IndexedDB', e));
  }, []);
  const draftsRef = useRef(new Map<string, Map<string, unknown>>(Object.entries(initial?.drafts ?? {}).map(([ws, d]) => [ws, new Map(Object.entries(d))])));
  const draftsFor = useCallback((ws: string) => {
    let m = draftsRef.current.get(ws);
    if (!m) draftsRef.current.set(ws, (m = new Map()));
    return m;
  }, []);
  // Pending (debounced) draft writes by "ws\0tabId".
  const pendingRef = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const flushDrafts = useCallback(() => {
    for (const [k, p] of pendingRef.current) {
      clearTimeout(p.timer);
      pendingRef.current.delete(k);
      p.run();
    }
  }, []);
  const cancelPending = useCallback((prefix: string | null) => {
    for (const [k, p] of pendingRef.current) {
      if (prefix !== null && !k.startsWith(prefix)) continue;
      clearTimeout(p.timer);
      pendingRef.current.delete(k);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const open = storeFactory ?? (initial ? null : () => openStore());
    if (!open) return;
    open()
      .then(async (store) => {
        if (cancelled) return;
        if (!initial) {
          const { drafts, ...data } = await loadAll(store);
          if (cancelled) return;
          draftsRef.current = new Map(Object.entries(drafts).map(([ws, d]) => [ws, new Map(Object.entries(d))]));
          setState((s) => reducer(s, { type: 'load', data }));
        }
        storeRef.current = store;
        for (const job of queueRef.current.splice(0)) enqueue(job);
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((s) => withValidActive({ ...s, ready: true, loadError: e instanceof Error ? e.message : String(e), prefs: loadPrefs() }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write pending drafts right away when the page goes away or into the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushDrafts();
    };
    window.addEventListener('pagehide', flushDrafts);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushDrafts);
      document.removeEventListener('visibilitychange', onHide);
      flushDrafts();
    };
  }, [flushDrafts]);

  const dispatch = useCallback(
    (a0: Action) => {
      const prev = stateRef.current;
      const a: Action = isDataAction(a0) && !a0.ws ? { ...a0, ws: prev.prefs.activeWorkspaceId } : a0;
      const next = reducer(prev, a);
      if (next === prev) return;
      stateRef.current = next;
      setState(next);
      if (a.type === 'workspace/remove' && !next.data[a.id]) {
        draftsRef.current.delete(a.id);
        cancelPending(`${a.id}\0`);
      }
      if (a.type === 'wipe') {
        draftsRef.current.clear();
        cancelPending(null);
      }
      enqueue((store) => persist(store, a, prev, next));
    },
    [enqueue, cancelPending],
  );

  const setTabs = useCallback(
    (fn: (t: TabsState) => TabsState, ws?: string) => {
      const s = stateRef.current;
      const w = ws ?? s.prefs.activeWorkspaceId;
      const cur = s.session[w] ?? EMPTY_TABS;
      const nextTabs = fn(cur);
      if (nextTabs !== cur) dispatch({ type: 'tabs/set', ws: w, tabs: nextTabs });
    },
    [dispatch],
  );

  const setDraft = useCallback(
    (tabId: string, value: unknown, ws0?: string) => {
      const ws = ws0 ?? stateRef.current.prefs.activeWorkspaceId;
      const m = draftsFor(ws);
      const key = `${ws}\0${tabId}`;
      const pending = pendingRef.current.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRef.current.delete(key);
      }
      if (value === undefined) {
        if (!m.has(tabId)) return;
        m.delete(tabId);
        enqueue((store) => store.delete(STORES.drafts, [ws, tabId]));
      } else {
        m.set(tabId, value);
        const run = () => enqueue((store) => store.put(STORES.drafts, { ws, id: tabId, data: value, updatedAt: new Date().toISOString() } satisfies WsRow<unknown>));
        const timer = setTimeout(() => {
          pendingRef.current.delete(key);
          run();
        }, DRAFT_SAVE_DELAY);
        pendingRef.current.set(key, { timer, run });
        // An edited preview tab becomes a normal tab.
        if (stateRef.current.session[ws]?.tabs.some((t) => t.id === tabId && t.preview)) setTabs((t) => pinTab(t, tabId), ws);
      }
      bump();
    },
    [draftsFor, enqueue, bump, setTabs],
  );

  const view = useMemo(() => viewOf(state), [state]);
  const getState = useCallback(() => viewOf(stateRef.current), []);
  // New tabs nobody typed into are kept as drafts too, but they aren't unsaved work.
  const draftCount = useCallback((ws: string) => [...(draftsRef.current.get(ws) ?? new Map<string, unknown>())].filter(([id, d]) => !(id.startsWith('n:') && isPristineNew(d as PmItem))).length, []);
  // `tick` is a dependency on purpose: drafts live in a mutable map and their changes must re-render consumers.
  const value = useMemo<Ctx>(() => ({ state: view, dispatch, drafts: draftsFor(view.activeWorkspaceId), setDraft, draftCount, draftVersion: tick, setTabs, getState }), [view, dispatch, draftsFor, setDraft, draftCount, tick, setTabs, getState]);
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): Ctx {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error('useAppStore outside AppStoreProvider');
  return ctx;
}

export function newCollection(name: string): PmCollection {
  return { info: { _postman_id: uuid(), name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] };
}

export function newEnvironment(name: string): PmEnvironmentFile {
  return { id: uuid(), name, values: [], _postman_variable_scope: 'environment' };
}

export function newWorkspaceMeta(name: string, now = new Date().toISOString()): WorkspaceMeta {
  return { id: uuid(), name: cleanWorkspaceName(name) || 'Workspace', createdAt: now, updatedAt: now };
}
