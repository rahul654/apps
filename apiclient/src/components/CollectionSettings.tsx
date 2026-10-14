import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { downloadText } from '../lib/download';
import { collectionFileName, toCollectionFile } from '../lib/postman/export';
import { countRequests, updateItem } from '../lib/postman/items';
import { collectionId } from '../lib/postman/normalize';
import type { PmCollection, PmItemGroup, PmVariable } from '../lib/postman/types';
import { useWorkspace } from '../store/Workspace';
import { AuthEditor, ScriptsEditor } from './editors';
import { IconPlay } from './Icons';
import { KVEditor, Tabs, useToast } from './ui';

type Tab = 'overview' | 'variables' | 'auth' | 'scripts';

export function CollectionSettings({ collection, folder, parents }: { collection: PmCollection; folder?: PmItemGroup; parents?: PmItemGroup[] }) {
  const { dispatch } = useWorkspace();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, showToast] = useToast();
  const cid = collectionId(collection);
  const target = folder ?? collection;
  const name = folder ? (folder.name ?? '') : collection.info.name;
  const description = typeof target.description === 'string' ? target.description : folder ? '' : typeof collection.info.description === 'string' ? collection.info.description : (collection.info.description?.content ?? '');
  const put = (c: PmCollection) => dispatch({ type: 'collection/put', collection: c });
  const patchTarget = (patch: Partial<PmItemGroup> | Partial<PmCollection>) => {
    if (folder) put(updateItem(collection, folder.id!, (f) => ({ ...f, ...(patch as Partial<PmItemGroup>) })));
    else put({ ...collection, ...(patch as Partial<PmCollection>) });
  };
  const setName = (v: string) => (folder ? patchTarget({ name: v }) : put({ ...collection, info: { ...collection.info, name: v } }));
  const setDescription = (v: string) => (folder ? patchTarget({ description: v }) : put({ ...collection, info: { ...collection.info, description: v } }));
  const vars = (target.variable ?? []) as PmVariable[];
  const items = folder ? folder.item : collection.item;
  return (
    <div className="editor-inner">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to={`/c/${cid}`}>{collection.info.name}</Link>
        {(parents ?? []).map((p) => (
          <span key={p.id}>
            {' / '}
            <Link to={`/f/${cid}/${p.id}`}>{p.name}</Link>
          </span>
        ))}
        {folder && <span> / {folder.name}</span>}
      </nav>
      <div className="title-row">
        <input className="input title-input" value={name} onChange={(e) => setName(e.target.value)} aria-label={folder ? 'Folder name' : 'Collection name'} />
        <span className="pill muted">{countRequests(items)} requests</span>
        <button type="button" className="btn small" onClick={() => navigate(`/runner?c=${cid}${folder ? `&f=${folder.id}` : ''}`)}>
          <IconPlay size={14} /> Run
        </button>
        {!folder && (
          <button type="button" className="btn small" onClick={() => downloadText(JSON.stringify(toCollectionFile(collection), null, 2), collectionFileName(collection))}>
            Export v2.1
          </button>
        )}
      </div>
      <Tabs<Tab>
        label={folder ? 'Folder settings' : 'Collection settings'}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'variables', label: <>Variables {vars.length ? <span className="pill muted">{vars.length}</span> : null}</> },
          { id: 'auth', label: <>Auth {target.auth ? <span className="pill muted">{target.auth.type}</span> : null}</> },
          { id: 'scripts', label: <>Scripts {target.event?.length ? <span className="pill muted">{target.event.length}</span> : null}</> },
        ]}
      />
      <div className="tabpanel" role="tabpanel">
        {tab === 'overview' && (
          <div className="stack">
            <label className="field">
              <span>Description</span>
              <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <p className="small muted">
              {folder ? 'Folders can carry their own auth, variables and scripts; requests inside inherit them.' : 'Collection-level auth, variables and scripts apply to every request unless a folder or request overrides them. Changes here save immediately.'}
            </p>
            {!folder && (
              <dl className="small muted">
                <div>Postman id: <code>{collection.info._postman_id}</code></div>
              </dl>
            )}
          </div>
        )}
        {tab === 'variables' && (
          <div className="stack-sm">
            <KVEditor label={folder ? 'Folder variables' : 'Collection variables'} rows={vars.map((v) => ({ key: v.key ?? '', value: v.value === undefined || v.value === null ? '' : String(v.value), disabled: v.disabled, description: typeof v.description === 'string' ? v.description : undefined }))} onChange={(rows) => patchTarget({ variable: rows.map((r) => ({ key: r.key, value: r.value, type: 'string', ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) })) })} />
            <p className="tiny muted">Precedence (highest first): local script variables, iteration data, environment, request, folder, collection, globals.</p>
          </div>
        )}
        {tab === 'auth' && (
          <AuthEditor
            auth={target.auth}
            allowInherit={!!folder}
            onChange={(auth) => {
              if (folder) put(updateItem(collection, folder.id!, (f) => {
                const n = { ...f } as PmItemGroup;
                if (auth === undefined) delete n.auth;
                else n.auth = auth;
                return n;
              }));
              else {
                const n = { ...collection };
                if (auth === undefined || auth === null) delete n.auth;
                else n.auth = auth;
                put(n);
              }
            }}
          />
        )}
        {tab === 'scripts' && (
          <ScriptsEditor
            events={target.event}
            onChange={(event) => {
              if (folder) put(updateItem(collection, folder.id!, (f) => {
                const n = { ...f } as PmItemGroup;
                if (event) n.event = event;
                else delete n.event;
                return n;
              }));
              else {
                const n = { ...collection };
                if (event) n.event = event;
                else delete n.event;
                put(n);
              }
              showToast('Saved');
            }}
          />
        )}
      </div>
      {toast}
    </div>
  );
}
