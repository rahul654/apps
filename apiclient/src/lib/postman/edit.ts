/** Editing helpers that keep Postman's url object and event array in sync with the UI. */
import { uuid } from '../id';
import { updateItem } from './items';
import { parseRawUrl, urlObjectToString } from './normalize';
import { isItemGroup, type PmCollection, type PmEvent, type PmHeader, type PmItem, type PmQueryParam, type PmRequestObject, type PmUrlObject, type PmVariable, type PmResponse } from './types';

export function requestObject(item: PmItem): PmRequestObject {
  return typeof item.request === 'string' ? { method: 'GET', url: item.request, header: [] } : item.request;
}

export function urlObject(req: PmRequestObject): PmUrlObject {
  if (!req.url) return { raw: '' };
  return typeof req.url === 'string' ? parseRawUrl(req.url) : req.url;
}

/** The user typed in the URL bar: re-derive host/path/query, keep disabled params and path-variable values. */
export function setRawUrl(req: PmRequestObject, raw: string): PmRequestObject {
  const prev = urlObject(req);
  const next = parseRawUrl(raw);
  const disabled = (prev.query ?? []).filter((q) => q.disabled);
  const query = [...(next.query ?? []).map((q) => ({ ...q, ...(descriptionFor(prev.query, q.key) ? { description: descriptionFor(prev.query, q.key) } : {}) })), ...disabled];
  const variable = (next.variable ?? []).map((v) => prev.variable?.find((p) => p.key === v.key) ?? v);
  const out: PmUrlObject = { ...prev, ...next, raw };
  if (query.length) out.query = query;
  else delete out.query;
  if (variable.length) out.variable = variable;
  else delete out.variable;
  for (const k of ['protocol', 'host', 'port', 'path', 'hash'] as const) if (next[k] === undefined) delete out[k];
  return { ...req, url: out };
}

function descriptionFor(list: PmQueryParam[] | undefined, key: string | null | undefined): PmQueryParam['description'] | undefined {
  return list?.find((q) => q.key === key)?.description;
}

/** The user edited the params table: rebuild `raw` from the parts. */
export function setQuery(req: PmRequestObject, query: PmQueryParam[]): PmRequestObject {
  const prev = urlObject(req);
  const out: PmUrlObject = { ...prev, query };
  if (!query.length) delete out.query;
  out.raw = urlObjectToString({ ...out, raw: undefined });
  return { ...req, url: out };
}

export function setPathVariables(req: PmRequestObject, variable: PmVariable[]): PmRequestObject {
  const prev = urlObject(req);
  const out: PmUrlObject = { ...prev, variable };
  if (!variable.length) delete out.variable;
  return { ...req, url: out };
}

export function eventCode(events: PmEvent[] | undefined, listen: 'prerequest' | 'test'): string {
  const e = events?.find((x) => x.listen === listen && !x.disabled);
  const exec = e?.script?.exec;
  return Array.isArray(exec) ? exec.join('\n') : typeof exec === 'string' ? exec : '';
}

/** Writes a script into the Postman `event` array (replacing the enabled one; removing it when empty). */
export function setEventCode(events: PmEvent[] | undefined, listen: 'prerequest' | 'test', code: string): PmEvent[] | undefined {
  const list = events ?? [];
  const i = list.findIndex((x) => x.listen === listen && !x.disabled);
  if (!code.trim()) {
    const out = list.filter((_, j) => j !== i);
    return out.length ? out : undefined;
  }
  const exec = code.split('\n');
  if (i >= 0) return list.map((e, j) => (j === i ? { ...e, script: { ...(e.script ?? {}), type: 'text/javascript', exec } } : e));
  return [...list, { listen, script: { type: 'text/javascript', exec } }];
}

export function newRequestItem(name = 'New request'): PmItem {
  return { id: uuid(), name, request: { method: 'GET', header: [], url: { raw: '' } }, response: [] };
}

export function exampleFromResponse(item: PmItem, r: { status: number; statusText: string; headers: { key: string; value: string }[]; bodyText: string; contentType: string; time: number }, name: string): PmResponse {
  const lang = /json/i.test(r.contentType) ? 'json' : /html/i.test(r.contentType) ? 'html' : /xml/i.test(r.contentType) ? 'xml' : 'text';
  return {
    id: uuid(),
    name,
    originalRequest: JSON.parse(JSON.stringify(requestObject(item))) as PmRequestObject,
    status: r.statusText,
    code: r.status,
    _postman_previewlanguage: lang,
    header: r.headers.map((h) => ({ key: h.key, value: h.value })),
    cookie: [],
    body: r.bodyText,
    responseTime: Math.round(r.time),
  };
}

/* ---------- Examples (saved responses in a request's `response[]`) ---------- */

/** Adds an example to the saved request `iid` (not to a draft), keeping the v2.1 shape. */
export function addExample(collection: PmCollection, iid: string, ex: PmResponse): PmCollection {
  return updateItem(collection, iid, (it) => (isItemGroup(it) ? it : { ...it, response: [...(it.response ?? []), ex] }));
}

export function updateExample(collection: PmCollection, iid: string, ex: PmResponse): PmCollection {
  return updateItem(collection, iid, (it) => (isItemGroup(it) ? it : { ...it, response: (it.response ?? []).map((r) => (r.id === ex.id ? ex : r)) }));
}

export function removeExample(collection: PmCollection, iid: string, eid: string): PmCollection {
  return updateItem(collection, iid, (it) => (isItemGroup(it) ? it : { ...it, response: (it.response ?? []).filter((r) => r.id !== eid) }));
}

/** The example's saved request snapshot as an object (Postman also allows a bare URL string). */
export function exampleRequest(ex: PmResponse): PmRequestObject {
  const r = ex.originalRequest;
  if (!r) return { method: 'GET', header: [], url: { raw: '' } };
  return typeof r === 'string' ? { method: 'GET', header: [], url: parseRawUrl(r) } : r;
}

/** Example response headers as key/value rows (v2.1 also allows raw header strings). */
export function exampleHeaders(ex: PmResponse): PmHeader[] {
  const h = ex.header;
  if (!h) return [];
  const list = typeof h === 'string' ? h.split(/\r?\n/) : h;
  return list.flatMap((x): PmHeader[] => {
    if (typeof x !== 'string') return [x];
    const i = x.indexOf(':');
    return i > 0 ? [{ key: x.slice(0, i).trim(), value: x.slice(i + 1).trim() }] : [];
  });
}

/* ---------- Request drafts ---------- */

/** A request draft never owns `response[]`: examples are saved straight into the collection. */
export function withoutResponses(item: PmItem): PmItem {
  if (!('response' in item)) return item;
  const { response: _r, ...rest } = item;
  return rest as PmItem;
}

/** Whether a request draft differs from the saved request (examples ignored). */
export function requestChanged(draft: PmItem, saved: PmItem): boolean {
  return JSON.stringify(withoutResponses(draft)) !== JSON.stringify(withoutResponses(saved));
}

export const UNTITLED_REQUEST = 'Untitled request';

export function newUntitledItem(): PmItem {
  return { id: uuid(), name: UNTITLED_REQUEST, request: { method: 'GET', header: [], url: { raw: '' } } };
}

/** A new tab nobody has typed into yet (closing it needs no prompt, and it isn't "unsaved"). */
export function isPristineNew(item: PmItem): boolean {
  const req = requestObject(item);
  const url = urlObject(req);
  const headers = Array.isArray(req.header) ? req.header : [];
  return (item.name ?? '') === UNTITLED_REQUEST && (req.method ?? 'GET') === 'GET' && !url.raw && !headers.length && !req.body && !req.auth && !item.event?.length;
}
