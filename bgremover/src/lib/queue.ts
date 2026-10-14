import { DEFAULT_REFINE, type Refine } from './mask';
import type { Backend, ModelId } from './models';

export type ItemStatus = 'queued' | 'processing' | 'done' | 'error';

export interface QueueItem {
  id: string;
  name: string;
  bytes: number;
  status: ItemStatus;
  /** Model the item is queued for or was processed with. */
  model: ModelId;
  error?: string;
  width?: number;
  height?: number;
  backend?: Backend;
  ms?: number;
  refine: Refine;
  /** Bumped on every mask change (inference, brush, undo) so views know to redraw. */
  rev: number;
}

export interface QueueState {
  items: QueueItem[];
  selectedId: string | null;
}

export type QueueAction =
  | { type: 'add'; items: { id: string; name: string; bytes: number }[]; model: ModelId }
  | { type: 'start'; id: string }
  | { type: 'done'; id: string; width: number; height: number; backend: Backend; ms: number }
  | { type: 'fail'; id: string; error: string }
  /** Puts items back in the queue (retry after an error, or re-run with another model). */
  | { type: 'requeue'; ids: string[]; model: ModelId }
  /** Returns an item that was interrupted mid-run (e.g. the engine was reset) to the queue. */
  | { type: 'interrupt'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'select'; id: string | null }
  | { type: 'refine'; id: string; refine: Refine }
  | { type: 'touch'; id: string };

export const emptyQueue = (): QueueState => ({ items: [], selectedId: null });

const patch = (state: QueueState, id: string, fn: (it: QueueItem) => QueueItem): QueueState => ({
  ...state,
  items: state.items.map((it) => (it.id === id ? fn(it) : it)),
});

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add': {
      const known = new Set(state.items.map((i) => i.id));
      const fresh: QueueItem[] = action.items
        .filter((i) => !known.has(i.id))
        .map((i) => ({ ...i, status: 'queued', model: action.model, refine: { ...DEFAULT_REFINE }, rev: 0 }));
      if (!fresh.length) return state;
      return { items: [...state.items, ...fresh], selectedId: state.selectedId ?? fresh[0].id };
    }
    case 'start':
      return patch(state, action.id, (it) => (it.status === 'queued' ? { ...it, status: 'processing', error: undefined } : it));
    case 'done':
      return patch(state, action.id, (it) =>
        it.status === 'processing'
          ? { ...it, status: 'done', width: action.width, height: action.height, backend: action.backend, ms: action.ms, rev: it.rev + 1 }
          : it,
      );
    case 'fail':
      return patch(state, action.id, (it) => (it.status === 'processing' ? { ...it, status: 'error', error: action.error } : it));
    case 'requeue': {
      const ids = new Set(action.ids);
      return {
        ...state,
        items: state.items.map((it) => (ids.has(it.id) && it.status !== 'processing' ? { ...it, status: 'queued', model: action.model, error: undefined } : it)),
      };
    }
    case 'interrupt':
      return patch(state, action.id, (it) => (it.status === 'processing' ? { ...it, status: 'queued' } : it));
    case 'remove': {
      const idx = state.items.findIndex((i) => i.id === action.id);
      if (idx < 0) return state;
      const items = state.items.filter((i) => i.id !== action.id);
      let selectedId = state.selectedId;
      if (selectedId === action.id) selectedId = (items[idx] ?? items[idx - 1])?.id ?? null;
      return { items, selectedId };
    }
    case 'clear':
      return emptyQueue();
    case 'select':
      return action.id === null || state.items.some((i) => i.id === action.id) ? { ...state, selectedId: action.id } : state;
    case 'refine':
      return patch(state, action.id, (it) => ({ ...it, refine: { ...action.refine } }));
    case 'touch':
      return patch(state, action.id, (it) => ({ ...it, rev: it.rev + 1 }));
  }
}

/** The next item to process: the first queued one, but only while nothing else is running (one at a time). */
export function nextToProcess(state: QueueState): QueueItem | null {
  if (state.items.some((i) => i.status === 'processing')) return null;
  return state.items.find((i) => i.status === 'queued') ?? null;
}

export function queueSummary(state: QueueState) {
  const counts = { queued: 0, processing: 0, done: 0, error: 0 };
  for (const it of state.items) counts[it.status]++;
  return { ...counts, total: state.items.length };
}
