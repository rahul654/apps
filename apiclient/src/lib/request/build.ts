/**
 * Turns a Postman request (with `{{variables}}`) into something fetch can send:
 * resolved URL with merged query, enabled headers, encoded body, applied auth.
 */
import { urlObjectToString } from '../postman/normalize';
import type { PmAuth, PmBody, PmHeader, PmItem, PmItemGroup, PmRequestObject, PmCollection } from '../postman/types';
import { resolve, type Scopes } from '../variables';

export interface KV {
  key: string;
  value: string;
}

export type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string; contentType: string | null }
  | { kind: 'form'; parts: { key: string; value?: string; file?: Blob; fileName?: string; contentType?: string }[] }
  | { kind: 'bytes'; bytes: Uint8Array; contentType: string | null; fileName?: string };

export interface PreparedRequest {
  method: string;
  url: string;
  headers: KV[];
  body: PreparedBody;
  /** Unresolved `{{variables}}`. */
  missing: string[];
  warnings: string[];
}

/** Files picked for form-data / binary bodies live only in memory (Postman stores just the name). */
export type FileLookup = (itemId: string, slot: string) => File | undefined;

export function urlToRaw(req: PmRequestObject): string {
  const u = req.url;
  if (!u) return '';
  return typeof u === 'string' ? u : urlObjectToString(u);
}

function stripQuery(raw: string): { base: string; query: string; hash: string } {
  let rest = raw;
  let hash = '';
  const h = rest.indexOf('#');
  if (h >= 0) {
    hash = rest.slice(h + 1);
    rest = rest.slice(0, h);
  }
  const q = rest.indexOf('?');
  if (q >= 0) return { base: rest.slice(0, q), query: rest.slice(q + 1), hash };
  return { base: rest, query: '', hash };
}

/** Path variables `/users/:id` → from url.variable list. */
function applyPathVariables(base: string, req: PmRequestObject, r: (s: string) => string): string {
  if (typeof req.url === 'string' || !req.url?.variable?.length) return base;
  let out = base;
  for (const v of req.url.variable) {
    if (!v.key || v.disabled) continue;
    const val = r(v.value === undefined || v.value === null ? '' : String(v.value));
    out = out.replace(new RegExp(`(?<=/):${escapeRe(v.key)}(?=/|$|\\?)`, 'g'), val);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function effectiveAuth(req: PmRequestObject, parents: PmItemGroup[], collection?: PmCollection): PmAuth | null {
  if (req.auth !== undefined) return req.auth;
  for (let i = parents.length - 1; i >= 0; i--) {
    if (parents[i].auth !== undefined) return parents[i].auth ?? null;
  }
  return collection?.auth ?? null;
}

export function authAttr(auth: PmAuth, key: string): string {
  const list = auth[auth.type];
  if (!Array.isArray(list)) return '';
  const a = (list as { key: string; value?: unknown }[]).find((x) => x.key === key);
  return a?.value === undefined || a.value === null ? '' : String(a.value);
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface AuthResult {
  headers: KV[];
  query: KV[];
  warnings: string[];
}

export function applyAuth(auth: PmAuth | null, r: (s: string) => string): AuthResult {
  const res: AuthResult = { headers: [], query: [], warnings: [] };
  if (!auth || auth.type === 'noauth') return res;
  switch (auth.type) {
    case 'bearer': {
      const token = r(authAttr(auth, 'token'));
      res.headers.push({ key: 'Authorization', value: `Bearer ${token}` });
      break;
    }
    case 'basic': {
      const user = r(authAttr(auth, 'username'));
      const pass = r(authAttr(auth, 'password'));
      res.headers.push({ key: 'Authorization', value: `Basic ${b64(`${user}:${pass}`)}` });
      break;
    }
    case 'apikey': {
      const key = r(authAttr(auth, 'key'));
      const value = r(authAttr(auth, 'value'));
      if (authAttr(auth, 'in') === 'query') res.query.push({ key, value });
      else res.headers.push({ key, value });
      break;
    }
    case 'oauth2': {
      const token = r(authAttr(auth, 'accessToken'));
      if (token) {
        const prefix = r(authAttr(auth, 'headerPrefix')) || 'Bearer';
        if (authAttr(auth, 'addTokenTo') === 'queryParams') res.query.push({ key: 'access_token', value: token });
        else res.headers.push({ key: 'Authorization', value: `${prefix} ${token}` });
      } else res.warnings.push('OAuth 2.0 token flows are not supported; set accessToken in the auth settings or use a bearer token.');
      break;
    }
    default:
      res.warnings.push(`Auth type "${auth.type}" is not supported here; the request was sent without it.`);
  }
  return res;
}

const RAW_TYPES: Record<string, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
};

export function rawLanguage(body: PmBody | null | undefined): string {
  return body?.options?.raw?.language ?? 'text';
}

export function encodeBody(body: PmBody | null | undefined, r: (s: string) => string, itemId: string, files?: FileLookup): { body: PreparedBody; warnings: string[] } {
  const warnings: string[] = [];
  if (!body || body.disabled || !body.mode) return { body: { kind: 'none' }, warnings };
  switch (body.mode) {
    case 'raw':
      return { body: { kind: 'text', text: r(body.raw ?? ''), contentType: RAW_TYPES[rawLanguage(body)] ?? null }, warnings };
    case 'urlencoded': {
      const p = new URLSearchParams();
      for (const e of body.urlencoded ?? []) if (!e.disabled && e.key) p.append(r(e.key), r(e.value ?? ''));
      return { body: { kind: 'text', text: p.toString(), contentType: 'application/x-www-form-urlencoded' }, warnings };
    }
    case 'formdata': {
      const parts: Extract<PreparedBody, { kind: 'form' }>['parts'] = [];
      for (const e of body.formdata ?? []) {
        if (e.disabled || !e.key) continue;
        if (e.type === 'file') {
          const f = files?.(itemId, `formdata:${e.key}`);
          if (f) parts.push({ key: r(e.key), file: f, fileName: f.name, contentType: e.contentType });
          else warnings.push(`File for form field "${e.key}" is not loaded in this session; pick it again.`);
        } else parts.push({ key: r(e.key), value: r(e.value ?? ''), contentType: e.contentType });
      }
      return { body: { kind: 'form', parts }, warnings };
    }
    case 'file': {
      const f = files?.(itemId, 'file');
      if (!f) {
        warnings.push('Binary body file is not loaded in this session; pick it again.');
        return { body: { kind: 'none' }, warnings };
      }
      return { body: { kind: 'bytes', bytes: new Uint8Array(0), contentType: f.type || 'application/octet-stream', fileName: f.name }, warnings };
    }
    case 'graphql': {
      let variables: unknown = undefined;
      const vText = r(body.graphql?.variables ?? '');
      if (vText.trim()) {
        try {
          variables = JSON.parse(vText);
        } catch {
          warnings.push('GraphQL variables are not valid JSON; sent without variables.');
        }
      }
      return { body: { kind: 'text', text: JSON.stringify({ query: r(body.graphql?.query ?? ''), ...(variables !== undefined ? { variables } : {}) }), contentType: 'application/json' }, warnings };
    }
    default:
      return { body: { kind: 'none' }, warnings };
  }
}

export interface BuildOptions {
  scopes: Scopes;
  parents?: PmItemGroup[];
  collection?: PmCollection;
  files?: FileLookup;
}

export function hasHeader(headers: KV[], name: string): boolean {
  const n = name.toLowerCase();
  return headers.some((h) => h.key.toLowerCase() === n);
}

export function buildRequest(item: PmItem, opts: BuildOptions): PreparedRequest {
  const req = typeof item.request === 'string' ? { method: 'GET', url: item.request } : item.request;
  const missing = new Set<string>();
  const warnings: string[] = [];
  const r = (s: string) => {
    const res = resolve(s, opts.scopes);
    res.missing.forEach((m) => missing.add(m));
    return res.text;
  };

  // URL: resolve the base, then merge enabled query params from the url object (they are the source of truth).
  const raw = urlToRaw(req);
  const { base, query: rawQuery, hash } = stripQuery(r(raw));
  const resolvedBase = applyPathVariables(base, req, r);
  const query: KV[] = [];
  if (typeof req.url === 'object' && req.url?.query) {
    for (const q of req.url.query) if (!q.disabled && q.key) query.push({ key: r(q.key), value: q.value === null || q.value === undefined ? '' : r(q.value) });
  } else if (rawQuery) {
    for (const p of rawQuery.split('&')) {
      if (!p) continue;
      const i = p.indexOf('=');
      query.push(i < 0 ? { key: p, value: '' } : { key: p.slice(0, i), value: p.slice(i + 1) });
    }
  }

  const headers: KV[] = [];
  const headerList: PmHeader[] = Array.isArray(req.header) ? req.header : [];
  for (const h of headerList) if (!h.disabled && h.key) headers.push({ key: r(h.key), value: r(h.value ?? '') });

  const auth = applyAuth(effectiveAuth(req, opts.parents ?? [], opts.collection), r);
  for (const h of auth.headers) if (!hasHeader(headers, h.key)) headers.push(h);
  query.push(...auth.query);
  warnings.push(...auth.warnings);

  const enc = encodeBody(req.body, r, item.id ?? '', opts.files);
  warnings.push(...enc.warnings);
  const ct = enc.body.kind === 'text' ? enc.body.contentType : enc.body.kind === 'bytes' ? enc.body.contentType : null;
  if (ct && !hasHeader(headers, 'content-type')) headers.push({ key: 'Content-Type', value: ct });

  let url = resolvedBase;
  if (query.length) {
    const qs = query.map((q) => (q.value === '' && !q.key.includes('=') ? encodeQueryPart(q.key) : `${encodeQueryPart(q.key)}=${encodeQueryPart(q.value)}`)).join('&');
    url += `?${qs}`;
  }
  if (hash) url += `#${hash}`;
  if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = `http://${url}`;

  return { method: (req.method ?? 'GET').toUpperCase(), url, headers, body: enc.body, missing: [...missing], warnings };
}

/** Encodes spaces and non-ASCII but leaves already-encoded sequences and common safe characters alone. */
export function encodeQueryPart(s: string): string {
  return s.replace(/[^A-Za-z0-9\-._~!$'()*+,;:@/?%=]/g, (c) => encodeURIComponent(c)).replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
}

/** Headers a browser will refuse to set from a page. */
export const FORBIDDEN_HEADERS = ['accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via', 'user-agent'];

export function forbiddenHeaders(headers: KV[]): string[] {
  return headers.filter((h) => FORBIDDEN_HEADERS.includes(h.key.toLowerCase()) || /^(proxy-|sec-)/i.test(h.key)).map((h) => h.key);
}
