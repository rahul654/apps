import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BoardStore } from '../lib/boardStore';
import type { BoardMeta, BoardSnapshot, Thumbnail } from '../lib/types';

interface BoardsValue {
  store: BoardStore;
  boards: BoardMeta[];
  thumbs: ReadonlyMap<string, Thumbnail>;
  loading: boolean;
  /** Stored boards that failed validation and are hidden. */
  invalid: number;
  error: string | null;
  /** The last deleted board, for "Undo". */
  removed: BoardSnapshot | null;
  remove: (id: string) => Promise<void>;
  undoRemove: () => Promise<string | null>;
  dismissRemoved: () => void;
}

const BoardsContext = createContext<BoardsValue | null>(null);

let defaultStore: BoardStore | null = null;
export function getDefaultStore(): BoardStore {
  return (defaultStore ??= new BoardStore('whiteboard'));
}

export function BoardsProvider({ children, store: injected }: { children: ReactNode; store?: BoardStore }) {
  const store = injected ?? getDefaultStore();
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, Thumbnail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<BoardSnapshot | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [{ boards, invalid }, thumbs] = await Promise.all([store.list(), store.thumbnails()]);
      if (n !== seq.current) return;
      setBoards(boards);
      setInvalid(invalid);
      setThumbs(thumbs);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    void refresh();
    return store.subscribe((kind) => {
      if (kind === 'list') void refresh();
    });
  }, [store, refresh]);

  const remove = useCallback(
    async (id: string) => {
      const snap = await store.remove(id);
      if (snap) setRemoved(snap);
    },
    [store],
  );

  const undoRemove = useCallback(async () => {
    if (!removed) return null;
    await store.restore(removed);
    setRemoved(null);
    return removed.meta.id;
  }, [store, removed]);

  const dismissRemoved = useCallback(() => setRemoved(null), []);

  const value = useMemo<BoardsValue>(
    () => ({ store, boards, thumbs, loading, invalid, error, removed, remove, undoRemove, dismissRemoved }),
    [store, boards, thumbs, loading, invalid, error, removed, remove, undoRemove, dismissRemoved],
  );
  return <BoardsContext.Provider value={value}>{children}</BoardsContext.Provider>;
}

export function useBoards(): BoardsValue {
  const v = useContext(BoardsContext);
  if (!v) throw new Error('useBoards outside BoardsProvider');
  return v;
}
