/**
 * Moving and copying requests/folders between places in the collection tree (sidebar drag and
 * drop, "Move or copy to…"). Pure: returns the changed collections and the tab ids that have to
 * follow a moved request (tab ids encode the collection id: r:<cid>:<iid>, e:<cid>:<iid>:<eid>).
 */
import { uuid } from '../id';
import { exampleTabId, requestTabId } from '../tabs';
import { findItem, insertItem, moveItem, removeItem, walkItems } from './items';
import { collectionId, isItemGroup } from './normalize';
import type { PmCollection, PmItemGroup, PmItemOrGroup } from './types';

export interface ItemRef {
  cid: string;
  id: string;
}

/** A place in the tree: folder `parentId` (null = collection root) of collection `cid`, at `index` (end when omitted). */
export interface DropDest {
  cid: string;
  parentId: string | null;
  index?: number;
}

export type TransferMode = 'move' | 'copy';

export interface TransferResult {
  /** Collections to save (source and target; one when they're the same). */
  changed: PmCollection[];
  /** Open tabs (and their drafts/responses) to re-point: [old tab id, new tab id]. */
  tabMoves: [string, string][];
  /** The node as placed in the target (a copy has new ids). */
  node: PmItemOrGroup;
}

/** Deep copy with fresh ids for the node, every descendant and every saved example. */
export function cloneWithNewIds<T extends PmItemOrGroup>(node: T): T {
  const copy = JSON.parse(JSON.stringify(node)) as T;
  const reid = (n: PmItemOrGroup) => {
    n.id = uuid();
    if (isItemGroup(n)) n.item.forEach(reid);
    else n.response?.forEach((r) => (r.id = uuid()));
  };
  reid(copy);
  return copy;
}

const parentOf = (c: PmCollection, id: string): string | null => {
  const loc = findItem(c, id);
  return loc?.parents[loc.parents.length - 1]?.id ?? null;
};

/**
 * Why `from` can't go to `to` (for the UI), or null when it can. Copying to the same place is
 * allowed (it duplicates); moving into itself or one of its own subfolders is not.
 */
export function transferProblem(collections: PmCollection[], from: ItemRef, to: DropDest, mode: TransferMode): string | null {
  const src = collections.find((c) => collectionId(c) === from.cid);
  const dst = collections.find((c) => collectionId(c) === to.cid);
  const loc = src && findItem(src, from.id);
  if (!src || !dst || !loc) return 'That item no longer exists.';
  if (to.parentId) {
    const target = findItem(dst, to.parentId);
    if (!target || !isItemGroup(target.item)) return 'That folder no longer exists.';
    if (mode === 'move' && from.cid === to.cid && (to.parentId === from.id || target.parents.some((p) => p.id === from.id))) return 'A folder can’t go inside itself.';
  }
  if (mode === 'move' && from.cid === to.cid && parentOf(src, from.id) === to.parentId) {
    // Same list: dropping right before or right after itself (or at the end when it's last) changes nothing.
    const siblings = to.parentId ? (findItem(dst, to.parentId)!.item as PmItemGroup).item : dst.item;
    const index = to.index ?? siblings.length;
    if (index === loc.index || index === loc.index + 1) return 'It’s already there.';
  }
  return null;
}

/** Tab ids of every request and example in `node`, as seen from collection `cid`. */
function tabIdsIn(node: PmItemOrGroup, cid: string): { requests: string[]; examples: [string, string, string][] } {
  const requests: string[] = [];
  const examples: [string, string, string][] = [];
  const visit = (n: PmItemOrGroup) => {
    if (isItemGroup(n)) return;
    requests.push(n.id!);
    for (const r of n.response ?? []) if (r.id) examples.push([cid, n.id!, r.id]);
  };
  visit(node);
  if (isItemGroup(node)) walkItems(node.item, ({ item }) => visit(item));
  return { requests, examples };
}

/** Moves or copies `from` to `to`. Returns null when `transferProblem` says no. */
export function transferItem(collections: PmCollection[], from: ItemRef, to: DropDest, mode: TransferMode): TransferResult | null {
  if (transferProblem(collections, from, to, mode)) return null;
  const src = collections.find((c) => collectionId(c) === from.cid)!;
  const dst = collections.find((c) => collectionId(c) === to.cid)!;
  const node = findItem(src, from.id)!.item;

  if (mode === 'copy') {
    const copy = cloneWithNewIds(node);
    if (from.cid === to.cid && parentOf(src, from.id) === to.parentId) copy.name = `${node.name} copy`;
    return { changed: [insertItem(dst, to.parentId, copy, to.index)], tabMoves: [], node: copy };
  }

  if (from.cid === to.cid) {
    const next = moveItem(src, from.id, to.parentId, to.index ?? Number.MAX_SAFE_INTEGER);
    return { changed: [next], tabMoves: [], node };
  }

  // Across collections: keep the ids (open tabs follow), unless one is already used in the target.
  let placed = node;
  const targetIds = new Set<string>();
  walkItems(dst.item, ({ item }) => {
    targetIds.add(item.id!);
  });
  let clash = targetIds.has(node.id!);
  if (isItemGroup(node)) walkItems(node.item, ({ item }) => (clash ||= targetIds.has(item.id!)) ? false : undefined);
  if (clash) placed = cloneWithNewIds(node);
  const nextSrc = removeItem(src, from.id);
  const nextDst = insertItem(dst, to.parentId, placed, to.index);
  const tabMoves: [string, string][] = [];
  if (!clash) {
    const { requests, examples } = tabIdsIn(node, from.cid);
    for (const iid of requests) tabMoves.push([requestTabId(from.cid, iid), requestTabId(to.cid, iid)]);
    for (const [, iid, eid] of examples) tabMoves.push([exampleTabId(from.cid, iid, eid), exampleTabId(to.cid, iid, eid)]);
  }
  return { changed: [nextSrc, nextDst], tabMoves, node: placed };
}

export interface DestOption {
  dest: DropDest;
  /** "Collection / Folder / Subfolder" */
  label: string;
  depth: number;
}

/** Every collection root and folder, in tree order, for the "Move or copy to…" picker. */
export function destinationOptions(collections: PmCollection[]): DestOption[] {
  const out: DestOption[] = [];
  for (const c of collections) {
    const cid = collectionId(c);
    out.push({ dest: { cid, parentId: null }, label: c.info.name, depth: 0 });
    walkItems(c.item, ({ item, parents }) => {
      if (isItemGroup(item)) out.push({ dest: { cid, parentId: item.id! }, label: [c.info.name, ...parents.map((p) => p.name), item.name].join(' / '), depth: parents.length + 1 });
    });
  }
  return out;
}

/** "Collection / Folder" name of a destination. */
export function destinationName(collections: PmCollection[], dest: DropDest): string {
  return destinationOptions(collections).find((o) => o.dest.cid === dest.cid && o.dest.parentId === dest.parentId)?.label ?? 'that place';
}
