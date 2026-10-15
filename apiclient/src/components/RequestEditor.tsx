import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { executeItem, mergeCollectionVariables, mergeValues, type ExecResult } from '../lib/execute';
import { getFile } from '../lib/files';
import { exampleFromResponse, requestObject, setPathVariables, setQuery, setRawUrl, urlObject } from '../lib/postman/edit';
import { collectionId } from '../lib/postman/normalize';
import { scopedVariables, updateItem } from '../lib/postman/items';
import type { PmCollection, PmHeader, PmItem, PmItemGroup } from '../lib/postman/types';
import { buildRequest } from '../lib/request/build';
import { toCurl, toFetch } from '../lib/request/snippets';
import { scriptHost } from '../lib/scripts/host';
import { varsFromList } from '../lib/variables';
import { useAppStore } from '../store/AppStore';
import { HTTP_METHODS } from '../types';
import { AuthEditor, BodyEditor, ScriptsEditor, headersToRows } from './editors';
import { IconSave, IconSend } from './Icons';
import { ResponsePanel } from './ResponsePanel';
import { KVEditor, Tabs, useToast } from './ui';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'examples' | 'docs' | 'code';

export function RequestEditor({ collection, parents, item }: { collection: PmCollection; parents: PmItemGroup[]; item: PmItem }) {
  const { state, dispatch, drafts, bump } = useAppStore();
  const cid = collectionId(collection);
  const draft = (drafts.get(item.id!) as PmItem | undefined) ?? item;
  const setDraft = useCallback(
    (next: PmItem) => {
      drafts.set(item.id!, next);
      bump();
    },
    [drafts, item.id, bump],
  );
  const dirty = drafts.has(item.id!) && JSON.stringify(draft) !== JSON.stringify(item);
  const [tab, setTab] = useState<Tab>('params');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [toast, showToast] = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const req = requestObject(draft);
  const url = urlObject(req);
  const setReq = (patch: Partial<typeof req>) => setDraft({ ...draft, request: { ...req, ...patch } });

  const env = state.environments.find((e) => e.id === state.activeEnvironmentId) ?? null;
  const scopes = useMemo(
    () => ({ environment: env ? varsFromList(env.values) : {}, collectionChain: scopedVariables(collection, parents, draft).map(varsFromList), globals: varsFromList(state.globals.values) }),
    [env, collection, parents, draft, state.globals],
  );

  const save = useCallback(() => {
    const next = updateItem(collection, item.id!, () => draft);
    dispatch({ type: 'collection/put', collection: next });
    drafts.delete(item.id!);
    bump();
    showToast('Saved');
  }, [collection, item.id, draft, dispatch, drafts, bump, showToast]);

  const send = useCallback(async () => {
    if (sending) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    // The response may arrive after a workspace switch; its effects belong to this one.
    const ws = state.activeWorkspaceId;
    try {
      const res = await executeItem({ collection, parents, item: draft, environment: env, globals: state.globals, prefs: state.prefs, files: getFile, host: scriptHost(), signal: ac.signal });
      setResult(res);
      dispatch({ type: 'history/add', entry: res.history, ws });
      if (res.changes.environment && env) dispatch({ type: 'environment/put', env: mergeValues(env, res.changes.environment), ws });
      else if (res.changes.environment && !env && Object.keys(res.changes.environment).length) showToast('Script set environment variables, but no environment is active');
      if (res.changes.globals) dispatch({ type: 'globals/set', globals: mergeValues(state.globals, res.changes.globals), ws });
      if (res.changes.collection) dispatch({ type: 'collection/put', collection: mergeCollectionVariables(collection, res.changes.collection), ws });
      if (res.response.error?.kind !== 'abort') setTab((t) => t);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [sending, collection, parents, draft, env, state.globals, state.prefs, state.activeWorkspaceId, dispatch, showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
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

  const saveExample = () => {
    if (!result) return;
    const name = window.prompt('Example name', `${result.response.status} ${result.response.statusText}`.trim());
    if (!name) return;
    const ex = exampleFromResponse(draft, result.response, name);
    setDraft({ ...draft, response: [...(draft.response ?? []), ex] });
    showToast('Example added; save the request to keep it');
  };

  return (
    <div className="editor-inner">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to={`/c/${cid}`}>{collection.info.name}</Link>
        {parents.map((p) => (
          <span key={p.id}>
            {' / '}
            <Link to={`/f/${cid}/${p.id}`}>{p.name}</Link>
          </span>
        ))}
      </nav>
      <div className="title-row">
        <input className="input title-input" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Request name" />
        {dirty && <span className="unsaved">Unsaved changes</span>}
        <button type="button" className="btn small" onClick={save} disabled={!dirty}>
          <IconSave size={15} /> Save
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
        <input className="input mono url-input" value={url.raw ?? ''} onChange={(e) => setDraft({ ...draft, request: setRawUrl(req, e.target.value) })} placeholder="{{baseUrl}}/path?query=1" aria-label="Request URL" spellCheck={false} autoComplete="off" />
        {sending ? (
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!url.raw}>
            <IconSend size={15} /> Send
          </button>
        )}
      </form>
      {preview.missing.length > 0 && <p className="tiny warn-text">Unresolved: {preview.missing.map((m) => `{{${m}}}`).join(', ')}</p>}
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
          { id: 'examples', label: <>Examples {draft.response?.length ? <span className="pill muted">{draft.response.length}</span> : null}</> },
          { id: 'docs', label: 'Docs' },
          { id: 'code', label: 'Code' },
        ]}
      />
      <div className="tabpanel" role="tabpanel">
        {tab === 'params' && (
          <div className="stack">
            <KVEditor label="Query parameters" rows={query} onChange={(rows) => setDraft({ ...draft, request: setQuery(req, rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) }))) })} />
            {pathVars.length > 0 && (
              <div className="stack-sm">
                <h3>Path variables</h3>
                <KVEditor label="Path variables" rows={pathVars} onChange={(rows) => setDraft({ ...draft, request: setPathVariables(req, rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) }))) })} />
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
              setDraft({ ...draft, request: next });
            }}
          />
        )}
        {tab === 'scripts' && <ScriptsEditor events={draft.event} onChange={(event) => setDraft(event ? { ...draft, event } : (({ event: _e, ...rest }) => rest)(draft))} />}
        {tab === 'examples' && (
          <ul className="list">
            {(draft.response ?? []).map((ex) => (
              <li key={ex.id} className="card tight">
                <div className="row">
                  <strong>{ex.name}</strong>
                  <span className="pill muted">{ex.code} {ex.status}</span>
                  <span className="spacer" />
                  <button type="button" className="btn ghost small" onClick={() => setDraft({ ...draft, response: (draft.response ?? []).filter((r) => r.id !== ex.id) })}>
                    Remove
                  </button>
                </div>
                <pre className="codeview" style={{ maxHeight: 200 }}>{typeof ex.body === 'string' ? ex.body.slice(0, 4000) : ''}</pre>
              </li>
            ))}
            {!draft.response?.length && <li className="muted small">No saved examples. Send a request and use "Save as example". Examples are exported to Postman as responses.</li>}
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
      <ResponsePanel result={result} sending={sending} onSaveExample={result && !result.response.error ? saveExample : undefined} onCancel={() => abortRef.current?.abort()} />
      {toast}
    </div>
  );
}
