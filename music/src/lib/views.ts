import type { QueueItem } from '../store/player';
import type { Catalog, Category } from '../types';

export interface Views {
  /** Every song of every category, in catalog order (the home page's queue). */
  all: QueueItem[];
  /** Index in `all` where each category's songs start. */
  offsets: Map<string, number>;
  byCategory: Map<string, QueueItem[]>;
}

export function buildViews(catalog: Catalog): Views {
  const all: QueueItem[] = [];
  const offsets = new Map<string, number>();
  const byCategory = new Map<string, QueueItem[]>();
  for (const c of catalog.categories) {
    offsets.set(c.id, all.length);
    const items = c.songs.map((song) => ({ categoryId: c.id, song }));
    byCategory.set(c.id, items);
    all.push(...items);
  }
  return { all, offsets, byCategory };
}

export function findCategory(catalog: Catalog, id: string | undefined): Category | null {
  return catalog.categories.find((c) => c.id === id) ?? null;
}
