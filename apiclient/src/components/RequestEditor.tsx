import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { executeItem, mergeCollectionVariables, mergeValues } from '../lib/execute';
import { getFile } from '../lib/files';
import { addExample, exampleFromResponse, isPristineNew, removeExample, requestChanged, requestObject, setPathVariables, setQuery, setRawUrl, urlObject, withoutResponses } from '../lib/postman/edit';
import { collectionId } from '../lib/postman/normalize';
import { scopedVariables } from '../lib/postman/items';
import type { PmCollection, PmHeader, PmItem, PmItemGroup } from '../lib/postman/types';
import { buildRequest } from '../lib/request/build';
import { toCurl, toFetch } from '../lib/request/snippets';
import { scriptHost } from '../lib/scripts/host';
import { exampleTabId, openTab, tabRoute } from '../lib/tabs';
import { varsFromList } from '../lib/variables';
import { useAppStore } from '../store/AppStore';
import { runtimeKey, updateRuntime, useTabRuntime } from '../store/tabRuntime';
import { HTTP_METHODS } from '../types';
import { AuthEditor, BodyEditor, ScriptsEditor, headersToRows } from './editors';
import { IconExample, IconSave, IconSend, IconTrash } from './Icons';
import { ResponsePanel } from './ResponsePanel';
import { SaveRequestDialog } from './tabs/SaveRequestDialog';
import { useTabActions } from './tabs/useTabActions';
import { KVEditor, Tabs, useToast } from './ui';
import { VariablesProvider, withRequestVariable } from './vars/VariablesProvider';
import { VarInput } from './vars/VarInput';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'examples' | 'docs' | 'code';
const TABS: Tab[] = ['params', 'headers', 'body', 'auth', 'scripts', 'examples', 'docs', 'code'];

/**
 * Editor for one request tab. `item` is the saved request (or, for a new tab, its draft). Edits go
 * to the tab's draft (persisted), which is dropped again when it matches the saved request. The
 * response and the open section live in tabRuntime, so they survive switching tabs.
 */
export function RequestEditor({ tabId, collection, parents, item, isNew = false }: { tabId: string; collection: PmCollection; parents: PmItemGroup[]; item: PmItem; isNew?: boolean }) {
  const { state, dispatch, drafts, setDraft, setTabs, getState } = useAppStore();
  const navigate = useNavigate();
  const { saveTab, saveNewRequest } = useTabActions();
  const ws = state.activeWorkspaceId;
  const rtKey = runtimeKey(ws, tabId);
  const [rt, setRt] = useTabRuntime(rtKey);
  const cid = collectionId(collection);
  const stored = drafts.get(tabId) as PmItem | undefined;
  const draft = stored ?? item;
  const setDraftItem = useCallback(
    (next: PmItem) => {
      if (isNew) setDraft(tabId, next);
      else setDraft(tabId, requestChanged(next, item) ? withoutResponses(next) : undefined);
    },
    [isNew, setDraft, tabId, item],
  );
  const dirty = isNew ? !isPristineNew(draft) : !!stored;
  const tab: Tab = TABS.includes(rt.section as Tab) ? (rt.section as Tab) : 'params';
  const setTab = (t: Tab) => setRt({ section: t });
  const [toast, showToast] = useToast();
  const [saveDialog, setSaveDialog] = useState(false);
  const req = requestObject(draft);
  const url = urlObject(req);
  const setReq = (patch: Partial<typeof req>) => setDraftItem({ ...draft, request: { ...req, ...patch } });

  const env = state.environments.find((e) => e.id === state.activeEnvironmentId) ?? null;
  const scopes = useMemo(
    () => ({ environment: env ? varsFromList(env.values) : {}, collectionChain: scopedVariables(collection, parents, draft).map(varsFromList), globals: varsFromList(state.globals.values) }),
    [env, collection, parents, draft, state.globals],
  );

  const save = useCallback(() => {
    if (isNew) {
      setSaveDialog(true);
      return;
    }
    if (!stored) return;
    if (saveTab(tabId)) showToast('Saved');
  }, [isNew, stored, saveTab, tabId, showToast]);

  const send = useCallback(async () => {
    if (rt.sending) return;
    const ac = new AbortController();
    updateRuntime(rtKey, { sending: true, abort: ac });
    // The response may arrive after a tab or workspace switch; its effects belong to this one.
    try {
      const res = await executeItem({ collection, parents, item: draft, environment: env, globals: state.globals, prefs: state.prefs, files: getFile, host: scriptHost(), signal: ac.signal });
      updateRuntime(rtKey, { result: res });
      dispatch({ type: 'history/add', entry: res.history, ws });
      if (res.changes.environment && env) dispatch({ type: 'environment/put', env: mergeValues(env, res.changes.environment), ws });
      else if (res.changes.environment && !env && Object.keys(res.changes.environment).length) showToast('Script set environment variables, but no environment is active');
      if (res.changes.globals) dispatch({ type: 'globals/set', globals: mergeValues(state.globals, res.changes.globals), ws });
      if (res.changes.collection && !isNew) {
        const latest = getState().collections.find((c) => collectionId(c) === cid) ?? collection;
        dispatch({ type: 'collection/put', collection: mergeCollectionVariables(latest, res.changes.collection), ws });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      updateRuntime(rtKey, { sending: false, abort: null });
    }
  }, [rt.sending, rtKey, collection, parents, draft, env, state.globals, state.prefs, ws, dispatch, showToast, isNew, getState, cid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector('.modal-backdrop')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void send();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [send, save]);

  const preview = useMemo(() => buildRequest(draft, { scopes, parents, collection, files: getFile }), [draft, scopes, parents, collection]);
  const headers: PmHeader[] = Array.isArray(req.header) ? req.header : [];
  const query = (url.query ?? []).map((q) => ({ key: q.key ?? '', value: q.value ?? '', disabled: q.disabled, description: typeof q.description === 'string' ? q.description : undefined }));
  const pathVars = (url.variable ?? []).map((v) => ({ key: v.key ?? '', value: v.value === undefined || v.value === null ? '' : String(v.value), disabled: v.disabled, description: typeof v.description === 'string' ? v.description : undefined }));
  const examples = isNew ? [] : (item.response ?? []);

  /** Postman's "Save as example": stored straight into the saved request's response[], then opened. */
  const saveExample = () => {
    const result = rt.result;
    if (!result || isNew) return;
    const ex = exampleFromResponse(draft, result.response, draft.name || 'Example');
    const latest = getState().collections.find((c) => collectionId(c) === cid) ?? collection;
    dispatch({ type: 'collection/put', collection: addExample(latest, item.id!, ex) });
    const id = exampleTabId(cid, item.id!, ex.id!);
    setTabs((s) => openTab(s, id));
    navigate(tabRoute(id));
  };
  const deleteExample = (eid: string, name: string) => {
    if (!window.confirm(`Delete example "${name}"?`)) return;
    const latest = getState().collections.find((c) => collectionId(c) === cid) ?? collection;
    dispatch({ type: 'collection/put', collection: removeExample(latest, item.id!, eid) });
  };

  return (
    <VariablesProvider collection={collection} parents={parents} item={draft} onRequestVariable={(k, v) => setDraftItem(withRequestVariable(draft, k, v))}>
      <div className="editor-inner">
        <nav className="crumbs" aria-label="Breadcrumb">
          {isNew ? (
            <span>Unsaved request · not in a collection yet</span>
          ) : (
            <>
              <Link to={`/c/${cid}`}>{collection.info.name}</Link>
              {parents.map((p) => (
                <span key={p.id}>
                  {' / '}
                  <Link to={`/f/${cid}/${p.id}`}>{p.name}</Link>
                </span>
              ))}
            </>
          )}
        </nav>
        <div className="title-row">
          <input className="input title-input" value={draft.name ?? ''} onChange={(e) => setDraftItem({ ...draft, name: e.target.value })} aria-label="Request name" />
          {dirty && <span className="unsaved">Unsaved changes</span>}
          <button type="button" className="btn small" onClick={save} disabled={!dirty && !isNew}>
            <IconSave size={15} /> {isNew ? 'Save…' : 'Save'}
          </button>
        </div>
        <form
          className="urlbar"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <select className="input method-select" value={req.method ?? 'GET'} onChange={(e) => setReq({ method: e.target.value })} aria-label="HTTP method">
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {req.method && !(HTTP_METHODS as readonly string[]).includes(req.method) && <option value={req.method}>{req.method}</option>}
          </select>
          <VarInput className="input mono url-input" wrapperClassName="url-field" value={url.raw ?? ''} onChange={(v) => setDraftItem({ ...draft, request: setRawUrl(req, v) })} placeholder="{{baseUrl}}/path?query=1" aria-label="Request URL" spellCheck={false} autoComplete="off" />
          {rt.sending ? (
            <button type="button" className="btn" onClick={() => rt.abort?.abort()}>
              Cancel
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!url.raw}>
              <IconSend size={15} /> Send
            </button>
          )}
        </form>
        {preview.missing.length > 0 && <p className="tiny warn-text">Unresolved: {preview.missing.map((m) => `{{${m}}}`).join(', ')} · hover one to set its value</p>}
        <Tabs<Tab>
          label="Request sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'params', label: <>Params {query.filter((q) => !q.disabled).length ? <span className="pill muted">{query.filter((q) => !q.disabled).length}</span> : null}</> },
            { id: 'headers', label: <>Headers {headers.filter((h) => !h.disabled).length ? <span className="pill muted">{headers.filter((h) => !h.disabled).length}</span> : null}</> },
            { id: 'body', label: <>Body {req.body?.mode ? <span className="pill muted">{req.body.mode}</span> : null}</> },
            { id: 'auth', label: <>Auth {req.auth === undefined ? null : <span className="pill muted">{req.auth?.type ?? 'none'}</span>}</> },
            { id: 'scripts', label: <>Scripts {draft.event?.length ? <span className="pill muted">{draft.event.length}</span> : null}</> },
            ...(isNew ? [] : [{ id: 'examples' as const, label: <>Examples {examples.length ? <span className="pill muted">{examples.length}</span> : null}</> }]),
            { id: 'docs', label: 'Docs' },
            { id: 'code', label: 'Code' },
          ]}
        />
        <div className="tabpanel" role="tabpanel">
          {tab === 'params' && (
            <div className="stack">
              <KVEditor label="Query parameters" rows={query} onChange={(rows) => setDraftItem({ ...draft, request: setQuery(req, rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) }))) })} />
              {pathVars.length > 0 && (
                <div className="stack-sm">
                  <h3>Path variables</h3>
                  <KVEditor label="Path variables" rows={pathVars} onChange={(rows) => setDraftItem({ ...draft, request: setPathVariables(req, rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) }))) })} />
                </div>
              )}
            </div>
          )}
          {tab === 'headers' && <KVEditor label="Headers" rows={headersToRows(headers)} onChange={(rows) => setReq({ header: rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) })) })} />}
          {tab === 'body' && <BodyEditor body={req.body} itemId={draft.id!} onChange={(body) => setReq({ body })} />}
          {tab === 'auth' && (
            <AuthEditor
              auth={req.auth}
              onChange={(auth) => {
                const next = { ...req };
                if (auth === undefined) delete next.auth;
                else next.auth = auth;
                setDraftItem({ ...draft, request: next });
              }}
            />
          )}
          {tab === 'scripts' && <ScriptsEditor events={draft.event} onChange={(event) => setDraftItem(event ? { ...draft, event } : (({ event: _e, ...rest }) => rest)(draft))} />}
          {tab === 'examples' && (
            <ul className="list">
              {examples.map((ex) => (
                <li key={ex.id} className="card tight list-item">
                  <Link to={tabRoute(exampleTabId(cid, item.id!, ex.id!))} className="main-link" onDoubleClick={() => setTabs((s) => openTab(s, exampleTabId(cid, item.id!, ex.id!)))}>
                    <span className="name row nowrap">
                      <IconExample size={14} /> {ex.name}
                    </span>
                    <span className="tiny muted">{[ex.code, ex.status].filter(Boolean).join(' ')}</span>
                  </Link>
                  <button type="button" className="btn ghost small icon" aria-label={`Delete example ${ex.name}`} onClick={() => deleteExample(ex.id!, ex.name ?? '')}>
                    <IconTrash size={14} />
                  </button>
                </li>
              ))}
              {!examples.length && <li className="muted small">No saved examples. Send the request and use “Save as example”: it is stored under this request (Postman’s response[]) and listed in the sidebar.</li>}
            </ul>
          )}
          {tab === 'docs' && (
            <label className="field">
              <span>Description (Markdown is kept as text)</span>
              <textarea className="input" value={typeof req.description === 'string' ? req.description : (req.description?.content ?? '')} onChange={(e) => setReq({ description: e.target.value })} />
            </label>
          )}
          {tab === 'code' && (
            <div className="stack-sm">
              <h3>curl</h3>
              <pre className="codeview">{toCurl(preview)}</pre>
              <h3>fetch</h3>
              <pre className="codeview">{toFetch(preview)}</pre>
              <p className="tiny muted">Generated from the resolved request (variables substituted with the active environment).</p>
            </div>
          )}
        </div>
        <ResponsePanel result={rt.result} sending={rt.sending} onSaveExample={rt.result && !rt.result.response.error && !isNew ? saveExample : undefined} onCancel={() => rt.abort?.abort()} />
        {isNew && rt.result && <p className="tiny muted">Save the request to a collection to keep examples of its responses.</p>}
        {toast}
        {saveDialog && (
          <SaveRequestDialog
            initialName={draft.name ?? 'New request'}
            collections={state.collections}
            onCancel={() => setSaveDialog(false)}
            onSave={(o) => {
              setSaveDialog(false);
              saveNewRequest(tabId, o, true);
            }}
          />
        )}
      </div>
    </VariablesProvider>
  );
}
