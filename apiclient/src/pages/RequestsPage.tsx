import { Link, useParams } from 'react-router-dom';
import { CollectionSettings } from '../components/CollectionSettings';
import { RequestEditor } from '../components/RequestEditor';
import { Sidebar } from '../components/Sidebar';
import { findItem } from '../lib/postman/items';
import { collectionId, isItemGroup } from '../lib/postman/normalize';
import type { PmItem, PmItemGroup } from '../lib/postman/types';
import { useAppStore } from '../store/AppStore';

export function RequestsPage() {
  const { cid, iid, fid } = useParams();
  const { state } = useAppStore();
  const collection = cid ? state.collections.find((c) => collectionId(c) === cid) : undefined;
  const targetId = iid ?? fid ?? null;
  const loc = collection && targetId ? findItem(collection, targetId) : null;

  let content;
  if (cid && !collection) {
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
  } else if (collection && loc && !isItemGroup(loc.item)) {
    content = <RequestEditor key={loc.item.id} collection={collection} parents={loc.parents} item={loc.item as PmItem} />;
  } else if (collection && loc && isItemGroup(loc.item)) {
    content = <CollectionSettings key={loc.item.id} collection={collection} folder={loc.item as PmItemGroup} parents={loc.parents} />;
  } else if (collection) {
    content = <CollectionSettings key={cid} collection={collection} />;
  } else {
    content = (
      <div className="empty">
        <h2>Pick a request</h2>
        <p>Choose one from a collection, create a new collection, or <Link to="/data">import from Postman</Link>.</p>
        <p className="tiny">
          Everything you create stays in this browser (IndexedDB). <Link to="/about">How it works and what it can’t do</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className="workspace">
      <Sidebar activeId={targetId} activeCollectionId={cid ?? null} />
      <section className="editor" aria-label="Editor">
        {content}
      </section>
    </div>
  );
}
