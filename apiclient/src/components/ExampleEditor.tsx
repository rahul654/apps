/**
 * One saved example (an entry of a request's `response[]`), opened as a tab: the saved request
 * snapshot (`originalRequest`) and the saved response (status, headers, body). Renaming, editing
 * and deleting write back into that request's `response[]`; unsaved edits are a tab draft.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { exampleHeaders, exampleRequest, removeExample, setRawUrl, urlObject } from '../lib/postman/edit';
import { collectionId } from '../lib/postman/normalize';
import type { PmCollection, PmItem, PmItemGroup, PmResponse } from '../lib/postman/types';
import { closeTabs, requestTabId, tabRoute } from '../lib/tabs';
import { useAppStore } from '../store/AppStore';
import { HTTP_METHODS } from '../types';
import { BodyEditor, RawBodyEditor, headersToRows } from './editors';
import { IconSave, IconTrash } from './Icons';
import { KVEditor, StatusBadge, Tabs, useToast } from './ui';
import { useTabActions } from './tabs/useTabActions';
import { VariablesProvider } from './vars/VariablesProvider';
import { VarInput } from './vars/VarInput';

type ReqTab = 'headers' | 'body';
type ResTab = 'body' | 'headers';

const PREVIEW_LANGUAGES = ['json', 'xml', 'html', 'text', 'javascript'];

export function ExampleEditor({ tabId, collection, parents, item, example }: { tabId: string; collection: PmCollection; parents: PmItemGroup[]; item: PmItem; example: PmResponse }) {
  const { drafts, setDraft, dispatch, getState, setTabs } = useAppStore();
  const navigate = useNavigate();
  const { saveTab } = useTabActions();
  const [toast, showToast] = useToast();
  const [reqTab, setReqTab] = useState<ReqTab>('body');
  const [resTab, setResTab] = useState<ResTab>('body');
  const cid = collectionId(collection);
  const stored = drafts.get(tabId) as PmResponse | undefined;
  const ex = stored ?? example;
  const update = useCallback((next: PmResponse) => setDraft(tabId, JSON.stringify(next) === JSON.stringify(example) ? undefined : next), [setDraft, tabId, example]);
  const req = exampleRequest(ex);
  const url = urlObject(req);
  const setReq = (patch: Partial<typeof req>) => update({ ...ex, originalRequest: { ...req, ...patch } });
  const headers = exampleHeaders(ex);
  const reqHeaders = Array.isArray(req.header) ? req.header : [];

  const save = useCallback(() => {
    if (stored && saveTab(tabId)) showToast('Example saved');
  }, [stored, saveTab, tabId, showToast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !document.querySelector('.modal-backdrop')) {
        e.preventDefault();
        save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save]);

  const remove = () => {
    if (!window.confirm(`Delete example "${ex.name ?? ''}"?`)) return;
    const latest = getState().collections.find((c) => collectionId(c) === cid) ?? collection;
    setDraft(tabId, undefined);
    const next = closeTabs(getState().tabs, [tabId]);
    setTabs(() => next);
    dispatch({ type: 'collection/put', collection: removeExample(latest, item.id!, example.id!) });
    navigate(next.activeId ? tabRoute(next.activeId) : tabRoute(requestTabId(cid, item.id!)));
  };

  return (
    <VariablesProvider collection={collection} parents={parents} item={item}>
      <div className="editor-inner">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to={`/c/${cid}`}>{collection.info.name}</Link>
          {parents.map((p) => (
            <span key={p.id}>
              {' / '}
              <Link to={`/f/${cid}/${p.id}`}>{p.name}</Link>
            </span>
          ))}
          <span>
            {' / '}
            <Link to={tabRoute(requestTabId(cid, item.id!))}>{item.name}</Link>
          </span>
          <span> / example</span>
        </nav>
        <div className="title-row">
          <input className="input title-input" value={ex.name ?? ''} onChange={(e) => update({ ...ex, name: e.target.value })} aria-label="Example name" />
          {stored && <span className="unsaved">Unsaved changes</span>}
          <button type="button" className="btn small" onClick={save} disabled={!stored}>
            <IconSave size={15} /> Save
          </button>
          <button type="button" className="btn small danger" onClick={remove}>
            <IconTrash size={15} /> Delete
          </button>
        </div>

        <section className="card tight stack-sm" aria-label="Saved request">
          <h3>Request</h3>
          <div className="urlbar">
            <select className="input method-select" value={req.method ?? 'GET'} onChange={(e) => setReq({ method: e.target.value })} aria-label="Example request method">
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {req.method && !(HTTP_METHODS as readonly string[]).includes(req.method) && <option value={req.method}>{req.method}</option>}
            </select>
            <VarInput className="input mono url-input" wrapperClassName="url-field" value={url.raw ?? ''} onChange={(v) => update({ ...ex, originalRequest: setRawUrl(req, v) })} aria-label="Example request URL" spellCheck={false} autoComplete="off" />
          </div>
          <Tabs<ReqTab>
            label="Example request sections"
            value={reqTab}
            onChange={setReqTab}
            tabs={[
              { id: 'body', label: <>Body {req.body?.mode ? <span className="pill muted">{req.body.mode}</span> : null}</> },
              { id: 'headers', label: <>Headers {reqHeaders.length ? <span className="pill muted">{reqHeaders.length}</span> : null}</> },
            ]}
          />
          <div className="tabpanel" role="tabpanel">
            {reqTab === 'body' && <BodyEditor body={req.body} itemId={tabId} onChange={(body) => setReq({ body })} />}
            {reqTab === 'headers' && <KVEditor label="Example request headers" rows={headersToRows(reqHeaders)} onChange={(rows) => setReq({ header: rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) })) })} />}
          </div>
        </section>

        <section className="card tight stack-sm" aria-label="Saved response">
          <div className="row">
            <h3>Response</h3>
            <StatusBadge status={ex.code ?? 0} text={ex.status} />
          </div>
          <div className="row">
            <label className="row nowrap small">
              <span className="muted">Status code</span>
              <input className="input compact mono status-code" type="number" min={100} max={599} value={ex.code ?? ''} onChange={(e) => update({ ...ex, code: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Status code" />
            </label>
            <label className="row nowrap small grow">
              <span className="muted">Status text</span>
              <input className="input compact grow" value={ex.status ?? ''} onChange={(e) => update({ ...ex, status: e.target.value })} aria-label="Status text" />
            </label>
          </div>
          <Tabs<ResTab>
            label="Example response sections"
            value={resTab}
            onChange={setResTab}
            tabs={[
              { id: 'body', label: 'Body' },
              { id: 'headers', label: <>Headers {headers.length ? <span className="pill muted">{headers.length}</span> : null}</> },
            ]}
          />
          <div className="tabpanel" role="tabpanel">
            {resTab === 'body' && (
              <RawBodyEditor
                value={ex.body ?? ''}
                language={PREVIEW_LANGUAGES.includes(ex._postman_previewlanguage ?? '') ? ex._postman_previewlanguage! : 'text'}
                onChange={(body) => update({ ...ex, body })}
                onLanguage={(l) => update({ ...ex, _postman_previewlanguage: l })}
                ariaLabel="Example response body"
              />
            )}
            {resTab === 'headers' && <KVEditor label="Example response headers" withDescription={false} rows={headersToRows(headers)} onChange={(rows) => update({ ...ex, header: rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}) })) })} />}
          </div>
        </section>
        {toast}
      </div>
    </VariablesProvider>
  );
}
