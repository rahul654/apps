import { isItemGroup, type PmCollection, type PmItem, type PmItemGroup, type PmItemOrGroup, type PmVariable } from './types';

export interface ItemLocation {
  item: PmItemOrGroup;
  /** Enclosing folders, outermost first (the collection root is not included). */
  parents: PmItemGroup[];
  /** Index inside its parent list. */
  index: number;
}

/** Depth-first walk over every item and folder. */
export function walkItems(items: PmItemOrGroup[], fn: (loc: ItemLocation) => void | false, parents: PmItemGroup[] = []): void {
  items.forEach((item, index) => {
    if (fn({ item, parents, index }) === false) return;
    if (isItemGroup(item)) walkItems(item.item, fn, [...parents, item]);
  });
}

export function findItem(collection: PmCollection, id: string): ItemLocation | null {
  let found: ItemLocation | null = null;
  walkItems(collection.item, (loc) => {
    if (loc.item.id === id) {
      found = loc;
      return false;
    }
  });
  return found;
}

/** Requests in run order (depth-first), optionally restricted to a folder. */
export function listRequests(collection: PmCollection, folderId?: string): { item: PmItem; parents: PmItemGroup[] }[] {
  let roots = collection.item;
  if (folderId) {
    const loc = findItem(collection, folderId);
    if (!loc || !isItemGroup(loc.item)) return [];
    roots = loc.item.item;
  }
  const out: { item: PmItem; parents: PmItemGroup[] }[] = [];
  const base = folderId ? (findItem(collection, folderId)?.parents ?? []).concat(findItem(collection, folderId)!.item as PmItemGroup) : [];
  walkItems(roots, ({ item, parents }) => {
    if (!isItemGroup(item)) out.push({ item, parents: [...base, ...parents] });
  });
  return out;
}

function parentList(collection: PmCollection, parents: PmItemGroup[]): PmItemOrGroup[] {
  return parents.length ? parents[parents.length - 1].item : collection.item;
}

/** Returns a new collection with `id` replaced by `next(item)`. The collection object is cloned on the path only. */
export function updateItem(collection: PmCollection, id: string, next: (item: PmItemOrGroup) => PmItemOrGroup): PmCollection {
  const rec = (items: PmItemOrGroup[]): PmItemOrGroup[] | null => {
    let changed = false;
    const out = items.map((it) => {
      if (it.id === id) {
        changed = true;
        return next(it);
      }
      if (isItemGroup(it)) {
        const inner = rec(it.item);
        if (inner) {
          changed = true;
          return { ...it, item: inner };
        }
      }
      return it;
    });
    return changed ? out : null;
  };
  const items = rec(collection.item);
  return items ? { ...collection, item: items } : collection;
}

export function removeItem(collection: PmCollection, id: string): PmCollection {
  const rec = (items: PmItemOrGroup[]): PmItemOrGroup[] =>
    items.filter((it) => it.id !== id).map((it) => (isItemGroup(it) ? { ...it, item: rec(it.item) } : it));
  return { ...collection, item: rec(collection.item) };
}

/** Inserts `item` into folder `parentId` (or the root when null) at `index` (end by default). */
export function insertItem(collection: PmCollection, parentId: string | null, item: PmItemOrGroup, index?: number): PmCollection {
  const put = (list: PmItemOrGroup[]) => {
    const out = [...list];
    out.splice(index === undefined ? out.length : Math.max(0, Math.min(index, out.length)), 0, item);
    return out;
  };
  if (!parentId) return { ...collection, item: put(collection.item) };
  return updateItem(collection, parentId, (f) => (isItemGroup(f) ? { ...f, item: put(f.item) } : f));
}

/** Moves an item to another parent/position (no-op when it would move into itself). */
export function moveItem(collection: PmCollection, id: string, parentId: string | null, index: number): PmCollection {
  const loc = findItem(collection, id);
  if (!loc) return collection;
  if (parentId) {
    const target = findItem(collection, parentId);
    if (!target || !isItemGroup(target.item)) return collection;
    if (parentId === id || target.parents.some((p) => p.id === id)) return collection;
  }
  const sameParent = (parentId ?? null) === (loc.parents[loc.parents.length - 1]?.id ?? null);
  let idx = index;
  if (sameParent && loc.index < index) idx = index - 1;
  const removed = removeItem(collection, id);
  return insertItem(removed, parentId, loc.item, idx);
}

/** Variables declared on folders along the path, innermost first, then the collection. */
export function scopedVariables(collection: PmCollection, parents: PmItemGroup[], item?: PmItem): PmVariable[][] {
  const chain: PmVariable[][] = [];
  if (item?.variable) chain.push(item.variable);
  for (let i = parents.length - 1; i >= 0; i--) if (parents[i].variable) chain.push(parents[i].variable!);
  if (collection.variable) chain.push(collection.variable);
  return chain;
}

export function parentListOf(collection: PmCollection, parents: PmItemGroup[]): PmItemOrGroup[] {
  return parentList(collection, parents);
}

export function countRequests(items: PmItemOrGroup[]): number {
  let n = 0;
  walkItems(items, ({ item }) => {
    if (!isItemGroup(item)) n++;
  });
  return n;
}
