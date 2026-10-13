import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { defaultName } from '../lib/defaults';
import { loadData, parseData, saveData, STORAGE_KEY } from '../lib/storage';
import type { AppData, Sandbox } from '../types';

export type Action =
  | { type: 'create'; sandbox: Sandbox }
  | { type: 'update'; id: string; patch: Partial<Omit<Sandbox, 'id' | 'kind' | 'createdAt'>> }
  | { type: 'remove'; id: string }
  | { type: 'restore'; sandbox: Sandbox; index: number }
  | { type: 'clearAll' }
  | { type: 'sync'; data: AppData };

interface State {
  data: AppData;
  /** The last removed sandbox, for "Undo". Not persisted. */
  removed: { sandbox: Sandbox; index: number } | null;
  /** False when this change came from another tab, so it isn't written back. */
  dirty: boolean;
}

export function reducer(state: State, action: Action, now = Date.now()): State {
  const { sandboxes } = state.data;
  const withList = (list: Sandbox[], removed = state.removed): State => ({ data: { version: 1, sandboxes: list }, removed, dirty: true });
  switch (action.type) {
    case 'create':
      return withList([...sandboxes, action.sandbox]);
    case 'update':
      return withList(
        sandboxes.map((sb) => {
          if (sb.id !== action.id) return sb;
          const next: Sandbox = { ...sb, ...action.patch, updatedAt: now };
          if (action.patch.name !== undefined) {
            next.name = action.patch.name.trim() || defaultName(sb.kind, next.url);
            next.autoName = !action.patch.name.trim();
          } else if (next.autoName && action.patch.url !== undefined) {
            next.name = defaultName(sb.kind, next.url);
          }
          return next;
        }),
      );
    case 'remove': {
      const index = sandboxes.findIndex((sb) => sb.id === action.id);
      if (index < 0) return state;
      return withList(
        sandboxes.filter((sb) => sb.id !== action.id),
        { sandbox: sandboxes[index], index },
      );
    }
    case 'restore': {
      if (sandboxes.some((sb) => sb.id === action.sandbox.id)) return state;
      const list = [...sandboxes];
      list.splice(Math.min(action.index, list.length), 0, action.sandbox);
      return withList(list, null);
    }
    case 'clearAll':
      return withList([], null);
    case 'sync':
      return { data: action.data, removed: state.removed, dirty: false };
  }
}

interface Store {
  sandboxes: Sandbox[];
  removed: State['removed'];
  dispatch: (action: Action) => void;
  get: (id: string) => Sandbox | undefined;
}

const Ctx = createContext<Store | null>(null);

export function SandboxProvider({ children, initial }: { children: ReactNode; initial?: AppData }) {
  const [state, dispatch] = useReducer(
    (s: State, a: Action) => reducer(s, a),
    undefined,
    (): State => ({ data: initial ?? loadData(), removed: null, dirty: false }),
  );

  // Persist shortly after changes (HTML editing would otherwise write on every keystroke),
  // and flush when the page is hidden so nothing typed is lost.
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (!state.dirty) return;
    const t = window.setTimeout(() => saveData(state.data), 250);
    return () => window.clearTimeout(t);
  }, [state]);
  useEffect(() => {
    const flush = () => {
      if (latest.current.dirty) saveData(latest.current.data);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // Keep several open tabs of the app in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) dispatch({ type: 'sync', data: parseData(e.newValue) });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<Store>(
    () => ({
      sandboxes: state.data.sandboxes,
      removed: state.removed,
      dispatch,
      get: (id) => state.data.sandboxes.find((sb) => sb.id === id),
    }),
    [state.data, state.removed],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSandboxes(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useSandboxes must be used inside <SandboxProvider>');
  return store;
}
