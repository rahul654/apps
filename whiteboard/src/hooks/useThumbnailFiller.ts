import { useEffect, useRef } from 'react';
import type { BoardStore } from '../lib/boardStore';
import type { BoardMeta, Thumbnail } from '../lib/types';

const canRender = () => typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && !/jsdom/i.test(navigator.userAgent);

/**
 * Boards imported or created from a template have no preview until opened. Render missing or
 * stale previews one at a time, loading the exporter (editor chunk) only if any are needed.
 */
export function useThumbnailFiller(store: BoardStore, boards: readonly BoardMeta[], thumbs: ReadonlyMap<string, Thumbnail>) {
  const tried = useRef(new Map<string, number>());
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current || !canRender()) return;
    const todo = boards.find((b) => {
      if (b.elementCount === 0) return false;
      const t = thumbs.get(b.id);
      return (!t || t.revision < b.revision) && (tried.current.get(b.id) ?? -1) < b.revision;
    });
    if (!todo) return;
    busy.current = true;
    tried.current.set(todo.id, todo.revision);
    let cancelled = false;
    void (async () => {
      try {
        const [{ renderThumbnail }, loaded] = await Promise.all([import('../lib/thumbnail'), store.load(todo.id)]);
        if (!loaded || cancelled) return;
        const url = await renderThumbnail(loaded.scene.elements, loaded.scene.appState, loaded.files);
        if (url) await store.setThumbnail(todo.id, url, loaded.meta.revision);
      } catch {
        /* keep the placeholder */
      } finally {
        busy.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, boards, thumbs]);
}
