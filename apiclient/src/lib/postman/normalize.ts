/**
 * Turns any Postman collection JSON (v2.0 or v2.1) into the app's internal v2.1 model:
 * ids on every item, auth attributes as arrays, script exec as lines. Unknown fields are kept.
 */
import { uuid } from '../id';
import {
  COLLECTION_SCHEMA_V21,
  isItemGroup,
  type PmAuth,
  type PmAuthAttribute,
  type PmCollection,
  type PmEnvironmentFile,
  type PmEnvironmentValue,
  type PmEvent,
  type PmItem,
  type PmItemGroup,
  type PmItemOrGroup,
  type PmRequestObject,
  type PmUrlObject,
} from './types';

export class PostmanFormatError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function detectCollectionVersion(json: unknown): '2.1' | '2.0' | '1.0' | null {
  if (!isObj(json)) return null;
  const info = json.info;
  if (isObj(info) && typeof info.schema === 'string') {
    if (info.schema.includes('v2.1')) return '2.1';
    if (info.schema.includes('v2.0')) return '2.0';
  }
  if (isObj(info) && Array.isArray(json.item)) return '2.1';
  if (typeof json.name === 'string' && Array.isArray(json.requests) && Array.isArray(json.order)) return '1.0';
  return null;
}

/** v2.0 stores auth params as an object (`basic: {username, password}`); v2.1 as `[{key, value, type}]`. */
export function normalizeAuth(auth: unknown): PmAuth | null | undefined {
  if (auth === null) return null;
  if (!isObj(auth) || typeof auth.type !== 'string') return undefined;
  const out: PmAuth = { ...(auth as PmAuth) };
  for (const [k, v] of Object.entries(auth)) {
    if (k === 'type' || k === 'noauth') continue;
    if (isObj(v)) {
      out[k] = Object.entries(v).map<PmAuthAttribute>(([key, value]) => ({ key, value, type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string' }));
    }
  }
  return out;
}

export function normalizeEvents(events: unknown): PmEvent[] | undefined {
  if (!Array.isArray(events)) return undefined;
  return events
    .filter((e): e is PmEvent => isObj(e) && typeof e.listen === 'string')
    .map((e) => {
      if (!e.script) return e;
      const script = { ...e.script };
      if (typeof script.exec === 'string') script.exec = script.exec.split(/\r?\n/);
      if (!script.type) script.type = 'text/javascript';
      return { ...e, script };
    });
}

function normalizeRequest(req: unknown): PmRequestObject {
  if (typeof req === 'string') return { method: 'GET', url: req, header: [] };
  if (!isObj(req)) return { method: 'GET', url: '', header: [] };
  const out: PmRequestObject = { ...(req as PmRequestObject) };
  if (!out.method) out.method = 'GET';
  if (typeof out.header === 'string') {
    // Raw header block "Key: value\n…"
    out.header = out.header
      .split(/\r?\n/)
      .filter((l) => l.includes(':'))
      .map((l) => {
        const i = l.indexOf(':');
        return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
      });
  }
  if (out.header === undefined) out.header = [];
  if ('auth' in out) {
    const a = normalizeAuth(out.auth);
    if (a === undefined) delete out.auth;
    else out.auth = a;
  }
  if (out.url && isObj(out.url)) {
    const u = out.url as PmUrlObject;
    if (u.raw === undefined) out.url = { ...u, raw: urlObjectToString(u) };
  }
  return out;
}

function normalizeItems(items: unknown): PmItemOrGroup[] {
  if (!Array.isArray(items)) return [];
  return items.filter(isObj).map((raw): PmItemOrGroup => {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : typeof raw._postman_id === 'string' && raw._postman_id ? raw._postman_id : uuid();
    if (Array.isArray(raw.item) && !('request' in raw)) {
      const g: PmItemGroup = { ...(raw as PmItemGroup), id, name: typeof raw.name === 'string' ? raw.name : 'Folder', item: normalizeItems(raw.item) };
      const ev = normalizeEvents(raw.event);
      if (ev) g.event = ev;
      if ('auth' in raw) {
        const a = normalizeAuth(raw.auth);
        if (a === undefined) delete g.auth;
        else g.auth = a;
      }
      return g;
    }
    const it: PmItem = { ...(raw as PmItem), id, name: typeof raw.name === 'string' ? raw.name : 'Request', request: normalizeRequest(raw.request) };
    const ev = normalizeEvents(raw.event);
    if (ev) it.event = ev;
    if (Array.isArray(raw.response)) {
      it.response = raw.response.filter(isObj).map((r) => ({ ...r, id: typeof r.id === 'string' && r.id ? r.id : uuid() }));
    }
    return it;
  });
}

/** Parses/normalizes a v2.0 or v2.1 collection. Throws PostmanFormatError on anything else. */
export function normalizeCollection(json: unknown): PmCollection {
  const version = detectCollectionVersion(json);
  if (version === '1.0') throw new PostmanFormatError('This is a Postman Collection v1 file. Export it from Postman as Collection v2.1 and import that.');
  if (!version || !isObj(json)) throw new PostmanFormatError('Not a Postman collection: expected an object with "info" and "item".');
  const info = json.info as Record<string, unknown>;
  const col: PmCollection = {
    ...(json as PmCollection),
    info: {
      ...(info as PmCollection['info']),
      name: typeof info.name === 'string' && info.name ? info.name : 'Imported collection',
      _postman_id: typeof info._postman_id === 'string' && info._postman_id ? info._postman_id : uuid(),
      schema: COLLECTION_SCHEMA_V21,
    },
    item: normalizeItems(json.item),
  };
  const ev = normalizeEvents(json.event);
  if (ev) col.event = ev;
  if ('auth' in json) {
    const a = normalizeAuth(json.auth);
    if (a === undefined) delete col.auth;
    else col.auth = a;
  }
  if (col.variable !== undefined && !Array.isArray(col.variable)) delete col.variable;
  return col;
}

export function collectionId(c: PmCollection): string {
  return c.info._postman_id!;
}

/** Builds the string form of a URL object (Postman's `raw`). */
export function urlObjectToString(u: PmUrlObject): string {
  if (u.raw) return u.raw;
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host ?? '');
  const path = Array.isArray(u.path) ? u.path.map((p) => (typeof p === 'string' ? p : `:${p.value ?? ''}`)).join('/') : (u.path ?? '');
  const query = (u.query ?? [])
    .filter((q) => !q.disabled)
    .map((q) => (q.value === undefined || q.value === null ? `${q.key ?? ''}` : `${q.key ?? ''}=${q.value}`))
    .join('&');
  let s = '';
  if (u.protocol) s += `${u.protocol}://`;
  s += host;
  if (u.port) s += `:${u.port}`;
  if (path) s += (path.startsWith('/') ? '' : '/') + path;
  if (query) s += `?${query}`;
  if (u.hash) s += `#${u.hash}`;
  return s;
}

/** Splits a raw URL into Postman's url object fields (keeps `{{vars}}` untouched). */
export function parseRawUrl(raw: string): PmUrlObject {
  const out: PmUrlObject = { raw };
  let rest = raw.trim();
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    out.hash = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }
  const qIdx = rest.indexOf('?');
  if (qIdx >= 0) {
    const qs = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
    out.query = qs
      .split('&')
      .filter((p) => p.length)
      .map((p) => {
        const i = p.indexOf('=');
        return i < 0 ? { key: p, value: null } : { key: p.slice(0, i), value: p.slice(i + 1) };
      });
  }
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(rest);
  if (m) {
    out.protocol = m[1];
    rest = rest.slice(m[0].length);
  }
  const slash = rest.indexOf('/');
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const path = slash >= 0 ? rest.slice(slash + 1) : '';
  const portM = /^(.*):(\d+|\{\{[^}]+\}\})$/.exec(authority);
  const hostStr = portM ? portM[1] : authority;
  if (portM) out.port = portM[2];
  if (hostStr) out.host = hostStr.split('.');
  if (path) {
    const segs = path.split('/');
    out.path = segs;
    const vars = segs.filter((s) => s.startsWith(':') && s.length > 1).map((s) => ({ key: s.slice(1), value: '' }));
    if (vars.length) out.variable = vars;
  }
  return out;
}

/** Environments and globals share one file shape. */
export function normalizeEnvironment(json: unknown, scope: 'environment' | 'globals' = 'environment'): PmEnvironmentFile {
  if (!isObj(json) || !Array.isArray(json.values)) throw new PostmanFormatError('Not a Postman environment: expected an object with a "values" array.');
  const values: PmEnvironmentValue[] = json.values.filter(isObj).map((v) => ({
    ...(v as PmEnvironmentValue),
    key: String(v.key ?? ''),
    value: v.value === undefined || v.value === null ? '' : String(v.value),
    type: typeof v.type === 'string' ? v.type : 'default',
    enabled: v.enabled !== false,
  }));
  const declared = json._postman_variable_scope === 'globals' ? 'globals' : json._postman_variable_scope === 'environment' ? 'environment' : scope;
  return {
    ...(json as PmEnvironmentFile),
    id: typeof json.id === 'string' && json.id ? json.id : uuid(),
    name: typeof json.name === 'string' && json.name ? json.name : declared === 'globals' ? 'Globals' : 'Imported environment',
    values,
    _postman_variable_scope: declared,
  };
}

export function detectPostmanJson(json: unknown): 'collection' | 'environment' | 'globals' | 'collection-v1' | 'openapi' | null {
  if (!isObj(json)) return null;
  const v = detectCollectionVersion(json);
  if (v === '1.0') return 'collection-v1';
  if (v) return 'collection';
  if (Array.isArray(json.values) && (json._postman_variable_scope === 'globals' || (json.name === undefined && json._postman_variable_scope === undefined && json.id === undefined))) {
    return json._postman_variable_scope === 'globals' ? 'globals' : 'environment';
  }
  if (Array.isArray(json.values)) return json._postman_variable_scope === 'globals' ? 'globals' : 'environment';
  if (typeof json.openapi === 'string' || typeof json.swagger === 'string') return 'openapi';
  return null;
}

export { isItemGroup };
