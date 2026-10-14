/** Editing helpers that keep Postman's url object and event array in sync with the UI. */
import { uuid } from '../id';
import { parseRawUrl, urlObjectToString } from './normalize';
import type { PmEvent, PmItem, PmQueryParam, PmRequestObject, PmUrlObject, PmVariable, PmResponse } from './types';

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
