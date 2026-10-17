/**
 * Tab operations that need the store: what a tab shows (title, method, unsaved state), saving a
 * tab's draft (also for tabs that aren't mounted, e.g. from the close prompt) and saving a new
 * request into a collection.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { insertItem, findItem, updateItem } from '../../lib/postman/items';
import { isPristineNew, requestObject, updateExample, withoutResponses } from '../../lib/postman/edit';
import { collectionId, isItemGroup } from '../../lib/postman/normalize';
import type { PmCollection, PmItem, PmResponse } from '../../lib/postman/types';
import { parseTabId, replaceTabId, requestTabId, tabRoute } from '../../lib/tabs';
import { newCollection, useAppStore, type AppView } from '../../store/AppStore';
import { moveRuntime, runtimeKey } from '../../store/tabRuntime';

export interface TabInfo {
  kind: 'request' | 'example' | 'new';
  title: string;
  method?: string;
  /** Example status code. */
  code?: number;
  dirty: boolean;
  /** The request/example still exists (new tabs: their draft exists). */
  exists: boolean;
}

export function findTarget(view: Pick<AppView, 'collections'>, id: string): { collection: PmCollection; item: PmItem; example?: PmResponse } | null {
  const t = parseTabId(id);
  if (!t || t.kind === 'new') return null;
  const collection = view.collections.find((c) => collectionId(c) === t.cid);
  const loc = collection ? findItem(collection, t.iid) : null;
  if (!collection || !loc || isItemGroup(loc.item)) return null;
  const item = loc.item as PmItem;
  if (t.kind === 'request') return { collection, item };
  const example = item.response?.find((r) => r.id === t.eid);
  return example ? { collection, item, example } : null;
}

export function tabInfo(view: Pick<AppView, 'collections'>, drafts: ReadonlyMap<string, unknown>, id: string): TabInfo {
  const t = parseTabId(id);
  const d = drafts.get(id);
  if (!t) return { kind: 'request', title: 'Unknown', dirty: false, exists: false };
  if (t.kind === 'new') {
    const item = d as PmItem | undefined;
    return { kind: 'new', title: item?.name || 'Untitled request', method: item ? (requestObject(item).method ?? 'GET') : 'GET', dirty: !!item && !isPristineNew(item), exists: !!item };
  }
  const target = findTarget(view, id);
  if (t.kind === 'request') {
    const item = (d as PmItem | undefined) ?? target?.item;
    return { kind: 'request', title: item?.name || 'Untitled', method: item ? (requestObject(item).method ?? 'GET') : 'GET', dirty: !!d && !!target, exists: !!target };
  }
  const ex = (d as PmResponse | undefined) ?? target?.example;
  return { kind: 'example', title: ex?.name || 'Example', code: ex?.code, dirty: !!d && !!target, exists: !!target };
}

export function useTabActions() {
  const { getState, dispatch, drafts, setDraft, setTabs } = useAppStore();
  const navigate = useNavigate();

  /** Saves a request/example tab's draft into its collection. New tabs need a target: returns false. */
  const saveTab = useCallback(
    (id: string): boolean => {
      const t = parseTabId(id);
      const d = drafts.get(id);
      if (!t || t.kind === 'new') return false;
      if (!d) return true;
      const view = getState();
      const target = findTarget(view, id);
      if (!target) return false;
      if (t.kind === 'request') {
        const next = updateItem(target.collection, t.iid, (it) => {
          const saved = it as PmItem;
          return { ...withoutResponses(d as PmItem), ...(saved.response ? { response: saved.response } : {}) };
        });
        dispatch({ type: 'collection/put', collection: next });
      } else {
        dispatch({ type: 'collection/put', collection: updateExample(target.collection, t.iid, { ...(d as PmResponse), id: t.eid }) });
      }
      setDraft(id, undefined);
      return true;
    },
    [drafts, getState, dispatch, setDraft],
  );

  /**
   * Saves a new (unsaved) request tab into a collection (or a new one) and turns the tab into that
   * request's tab, keeping its place and response.
   */
  const saveNewRequest = useCallback(
    (tabId: string, opts: { cid: string | null; newCollectionName?: string; folderId: string | null; name: string }, isRoute: boolean): string | null => {
      const draft = drafts.get(tabId) as PmItem | undefined;
      if (!draft) return null;
      const view = getState();
      let c = opts.cid ? view.collections.find((x) => collectionId(x) === opts.cid) : undefined;
      if (!c) c = newCollection(opts.newCollectionName?.trim() || 'New collection');
      const item: PmItem = { ...withoutResponses(draft), name: opts.name.trim() || draft.name || 'New request', response: [] };
      const next = insertItem(c, opts.folderId, item);
      dispatch({ type: 'collection/put', collection: next });
      const rid = requestTabId(collectionId(next), item.id!);
      setDraft(tabId, undefined);
      setTabs((s) => replaceTabId(s, tabId, rid));
      moveRuntime(runtimeKey(view.activeWorkspaceId, tabId), runtimeKey(view.activeWorkspaceId, rid));
      if (isRoute) navigate(tabRoute(rid), { replace: true });
      return rid;
    },
    [drafts, getState, dispatch, setDraft, setTabs, navigate],
  );

  return { saveTab, saveNewRequest };
}
