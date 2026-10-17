import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CollectionSettings } from '../components/CollectionSettings';
import { ExampleEditor } from '../components/ExampleEditor';
import { RequestEditor } from '../components/RequestEditor';
import { Sidebar } from '../components/Sidebar';
import { RequestTabs } from '../components/tabs/RequestTabs';
import { tabInfo } from '../components/tabs/useTabActions';
import { findItem } from '../lib/postman/items';
import { collectionId, isItemGroup } from '../lib/postman/normalize';
import type { PmCollection, PmItem, PmItemGroup } from '../lib/postman/types';
import { exampleTabId, newTabId, openTab, pruneTabs, requestTabId, tabRoute } from '../lib/tabs';
import { useAppStore } from '../store/AppStore';
import { dropRuntime, runtimeKey } from '../store/tabRuntime';

/** Scratch collection for requests that aren't saved anywhere yet (no id, so history doesn't link it). */
const UNSAVED: PmCollection = { info: { name: 'Unsaved request', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] };

/**
 * Requests: sidebar, tab strip and the editor of the selected tab. The URL is the source of truth
 * for the selected tab: `#/r/:cid/:iid`, `#/e/:cid/:iid/:eid` and `#/new/:tid` open (or focus)
 * their tab, as a preview tab when newly opened; `#/` goes to the active tab.
 */
export function RequestsPage() {
  const { cid, iid, fid, eid, tid } = useParams();
  const { state, drafts, setTabs, setDraft } = useAppStore();
  const collection = cid ? state.collections.find((c) => collectionId(c) === cid) : undefined;
  const routeTab = tid ? newTabId(tid) : cid && iid ? (eid ? exampleTabId(cid, iid, eid) : requestTabId(cid, iid)) : null;
  const routeTabExists = routeTab ? tabInfo(state, drafts, routeTab).exists : false;

  // Open or focus the URL's tab (a preview tab when it wasn't open).
  useEffect(() => {
    if (routeTab && routeTabExists) setTabs((t) => openTab(t, routeTab, { preview: true, isDirty: (id) => drafts.has(id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTab, routeTabExists]);

  // Tabs whose request/example was deleted (or whose new-request draft is gone) close.
  useEffect(() => {
    const exists = (id: string) => tabInfo(state, drafts, id).exists;
    if (!state.tabs.tabs.some((t) => !exists(t.id))) return;
    const gone = state.tabs.tabs.filter((t) => !exists(t.id)).map((t) => t.id);
    for (const id of gone) {
      setDraft(id, undefined);
      dropRuntime(runtimeKey(state.activeWorkspaceId, id));
    }
    setTabs((t) => pruneTabs(t, exists));
  }, [state, drafts, setTabs, setDraft]);

  if (!cid && !tid && state.tabs.activeId && tabInfo(state, drafts, state.tabs.activeId).exists) return <Navigate to={tabRoute(state.tabs.activeId)} replace />;

  const targetId = iid ?? fid ?? null;
  const loc = collection && targetId ? findItem(collection, targetId) : null;
  let content;
  if (tid) {
    const item = drafts.get(newTabId(tid)) as PmItem | undefined;
    content = item ? (
      <RequestEditor key={routeTab} tabId={routeTab!} collection={UNSAVED} parents={[]} item={item} isNew />
    ) : (
      <div className="empty">
        <h2>That tab was closed</h2>
        <Link to="/" className="btn">Back</Link>
      </div>
    );
  } else if (cid && !collection) {
    content = (
      <div className="empty">
        <h2>That collection doesn’t exist</h2>
        <p>It may have been deleted. Pick another one from the list.</p>
        <Link to="/" className="btn">Back</Link>
      </div>
    );
  } else if (collection && targetId && !loc) {
    content = (
      <div className="empty">
        <h2>That request doesn’t exist</h2>
        <Link to={`/c/${cid}`} className="btn">Open {collection.info.name}</Link>
      </div>
    );
  } else if (collection && loc && !isItemGroup(loc.item) && eid) {
    const item = loc.item as PmItem;
    const example = item.response?.find((r) => r.id === eid);
    content = example ? (
      <ExampleEditor key={routeTab} tabId={routeTab!} collection={collection} parents={loc.parents} item={item} example={example} />
    ) : (
      <div className="empty">
        <h2>That example doesn’t exist</h2>
        <Link to={tabRoute(requestTabId(cid!, item.id!))} className="btn">Open {item.name}</Link>
      </div>
    );
  } else if (collection && loc && !isItemGroup(loc.item)) {
    content = <RequestEditor key={routeTab} tabId={routeTab!} collection={collection} parents={loc.parents} item={loc.item as PmItem} />;
  } else if (collection && loc && isItemGroup(loc.item)) {
    content = <CollectionSettings key={loc.item.id} collection={collection} folder={loc.item as PmItemGroup} parents={loc.parents} />;
  } else if (collection) {
    content = <CollectionSettings key={cid} collection={collection} />;
  } else {
    content = (
      <div className="empty">
        <h2>Pick a request</h2>
        <p>Choose one from a collection, open a new tab with +, create a new collection, or <Link to="/data">import from Postman</Link>.</p>
        <p className="tiny">
          Everything you create stays in this browser (IndexedDB). <Link to="/about">How it works and what it can’t do</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className="workspace">
      <Sidebar activeId={targetId} activeCollectionId={cid ?? null} activeExampleId={eid ?? null} />
      <section className="editor" aria-label="Editor">
        <RequestTabs routeTabId={routeTab} />
        <div className="editor-body">{content}</div>
      </section>
    </div>
  );
}
