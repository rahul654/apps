/** Lower-priority importers: a curl command line and OpenAPI 3 (JSON or YAML) → collection. */
import { uuid } from '../id';
import { parseRawUrl } from './normalize';
import { COLLECTION_SCHEMA_V21, type PmBody, type PmCollection, type PmHeader, type PmItem, type PmItemGroup, type PmRequestObject } from './types';

/** Splits a shell-ish command line honouring quotes and backslash continuations. */
export function shellSplit(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let q: string | null = null;
  const s = cmd.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === '\\' && i + 1 < s.length) cur += s[++i];
    else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else cur += c;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** `-F` value `key=@"my file.png";type=image/png` → file part; `key=text` → text part. */
function parseFormArg(f: string): { key: string; value: string; type: 'text' | 'file'; contentType?: string } {
  const j = f.indexOf('=');
  const key = f.slice(0, j);
  const v = f.slice(j + 1);
  if (!v.startsWith('@')) return { key, value: v, type: 'text' };
  let rest = v.slice(1);
  let name: string;
  if (rest.startsWith('"')) {
    let k = 1;
    name = '';
    for (; k < rest.length && rest[k] !== '"'; k++) name += rest[k] === '\\' && k + 1 < rest.length ? rest[++k] : rest[k];
    rest = rest.slice(k + 1);
  } else {
    const semi = rest.indexOf(';');
    name = semi < 0 ? rest : rest.slice(0, semi);
    rest = semi < 0 ? '' : rest.slice(semi);
  }
  const type = /;type=([^;]+)/.exec(rest)?.[1];
  return { key, value: name, type: 'file', ...(type ? { contentType: type } : {}) };
}

export function curlToRequest(cmd: string): { name: string; request: PmRequestObject } {
  const args = shellSplit(cmd.trim());
  if (args[0] !== 'curl') throw new Error('Expected a command starting with "curl".');
  let method: string | null = null;
  let url = '';
  const header: PmHeader[] = [];
  const data: string[] = [];
  const form: { key: string; value: string; type: 'text' | 'file'; contentType?: string }[] = [];
  let user: string | null = null;
  let binary = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i] ?? '';
    if (a === '-X' || a === '--request') method = next().toUpperCase();
    else if (a.startsWith('-X') && a.length > 2) method = a.slice(2).toUpperCase();
    else if (a === '-H' || a === '--header') {
      const h = next();
      const j = h.indexOf(':');
      if (j > 0) header.push({ key: h.slice(0, j).trim(), value: h.slice(j + 1).trim() });
    } else if (a === '-d' || a === '--data' || a === '--data-raw' || a === '--data-binary' || a === '--data-ascii' || a === '--data-urlencode') {
      data.push(next());
      if (a === '--data-binary') binary = true;
    } else if (a === '-F' || a === '--form') form.push(parseFormArg(next()));
    else if (a === '--form-string') {
      const f = next();
      const j = f.indexOf('=');
      form.push({ key: f.slice(0, j), value: f.slice(j + 1), type: 'text' });
    } else if (a === '-u' || a === '--user') user = next();
    else if (a === '--url') url = next();
    else if (a === '-A' || a === '--user-agent') header.push({ key: 'User-Agent', value: next() });
    else if (a === '-b' || a === '--cookie') header.push({ key: 'Cookie', value: next() });
    else if (a === '-e' || a === '--referer') header.push({ key: 'Referer', value: next() });
    else if (a === '-I' || a === '--head') method = 'HEAD';
    else if (a === '-G' || a === '--get') method = 'GET';
    else if (a === '-o' || a === '--output' || a === '--max-time' || a === '-m' || a === '--connect-timeout' || a === '--retry') next();
    else if (a.startsWith('-')) continue;
    else if (!url) url = a;
  }
  if (!url) throw new Error('No URL found in the curl command.');
  const request: PmRequestObject = { method: method ?? (data.length || form.length ? 'POST' : 'GET'), header, url: parseRawUrl(url) };
  if (form.length) {
    request.body = { mode: 'formdata', formdata: form.map((f) => (f.type === 'file' ? { key: f.key, type: 'file', src: f.value, ...(f.contentType ? { contentType: f.contentType } : {}) } : { key: f.key, value: f.value, type: 'text' })) };
  } else if (binary && data.length === 1 && data[0].startsWith('@')) {
    // --data-binary @file: Postman's binary body (only the file name is known).
    request.body = { mode: 'file', file: { src: data[0].slice(1) } };
  } else if (data.length) {
    const raw = data.join('&');
    const ct = header.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
    let body: PmBody;
    if (/json/i.test(ct) || (!ct && /^\s*[[{]/.test(raw))) {
      body = { mode: 'raw', raw, options: { raw: { language: 'json' } } };
      if (!ct) header.push({ key: 'Content-Type', value: 'application/json' });
    } else if (!binary && (/x-www-form-urlencoded/i.test(ct) || !ct)) {
      body = { mode: 'urlencoded', urlencoded: raw.split('&').filter(Boolean).map((p) => { const j = p.indexOf('='); return j < 0 ? { key: decodeURIComponent(p), value: '' } : { key: decodeURIComponent(p.slice(0, j)), value: decodeURIComponent(p.slice(j + 1).replace(/\+/g, ' ')) }; }) };
    } else body = { mode: 'raw', raw, options: { raw: { language: /xml/i.test(ct) ? 'xml' : /html/i.test(ct) ? 'html' : 'text' } } };
    request.body = body;
  }
  if (user) {
    const j = user.indexOf(':');
    request.auth = { type: 'basic', basic: [{ key: 'username', value: j < 0 ? user : user.slice(0, j), type: 'string' }, { key: 'password', value: j < 0 ? '' : user.slice(j + 1), type: 'string' }] };
  }
  let name = url;
  try {
    const u = new URL(url);
    name = `${request.method} ${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    /* keep */
  }
  return { name, request };
}

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string; version?: string };
  servers?: { url: string }[];
  paths?: Record<string, Record<string, OpenApiOp | unknown>>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, { type: string; scheme?: string; in?: string; name?: string }> };
  security?: Record<string, unknown>[];
  tags?: { name: string }[];
}
interface OpenApiOp {
  summary?: string;
  operationId?: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; schema?: { default?: unknown; example?: unknown; type?: string }; example?: unknown; description?: string }[];
  requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown; examples?: Record<string, { value?: unknown }> }> };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function exampleFromSchema(schema: unknown, doc: OpenApiDoc, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 6) return null;
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === 'string') {
    const name = s.$ref.split('/').pop() ?? '';
    return exampleFromSchema(doc.components?.schemas?.[name], doc, depth + 1);
  }
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (Array.isArray(s.allOf)) return Object.assign({}, ...(s.allOf as unknown[]).map((x) => exampleFromSchema(x, doc, depth + 1) ?? {}));
  if (Array.isArray(s.oneOf)) return exampleFromSchema(s.oneOf[0], doc, depth + 1);
  if (Array.isArray(s.anyOf)) return exampleFromSchema(s.anyOf[0], doc, depth + 1);
  const type = s.type ?? (s.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((s.properties as Record<string, unknown>) ?? {})) out[k] = exampleFromSchema(v, doc, depth + 1);
      return out;
    }
    case 'array':
      return [exampleFromSchema(s.items, doc, depth + 1)];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      return s.format === 'date-time' ? '2024-01-01T00:00:00Z' : s.format === 'date' ? '2024-01-01' : s.format === 'email' ? 'user@example.com' : s.format === 'uuid' ? '00000000-0000-4000-8000-000000000000' : 'string';
    default:
      return null;
  }
}

/** Basic OpenAPI 3 → collection: one folder per tag (or path), one request per operation, example bodies from schemas. */
export function openApiToCollection(doc: OpenApiDoc): PmCollection {
  if (!doc.openapi && !doc.swagger) throw new Error('Not an OpenAPI document (no "openapi" field).');
  const baseUrl = doc.servers?.[0]?.url ?? 'https://api.example.com';
  const variable = [{ key: 'baseUrl', value: baseUrl, type: 'string' }];
  const folders = new Map<string, PmItemGroup>();
  const root: PmItem[] = [];
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) {
      const op = (ops as Record<string, OpenApiOp | undefined>)[m];
      if (!op || typeof op !== 'object') continue;
      const params = [...((ops as { parameters?: OpenApiOp['parameters'] }).parameters ?? []), ...(op.parameters ?? [])];
      const query = params.filter((p) => p.in === 'query').map((p) => ({ key: p.name, value: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ''), disabled: !p.required, ...(p.description ? { description: p.description } : {}) }));
      const header: PmHeader[] = params.filter((p) => p.in === 'header').map((p) => ({ key: p.name, value: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ''), ...(p.required ? {} : { disabled: true }) }));
      const pathVars = params.filter((p) => p.in === 'path').map((p) => ({ key: p.name, value: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ''), ...(p.description ? { description: p.description } : {}) }));
      const pmPath = path.replace(/\{([^}]+)\}/g, ':$1');
      const raw = `{{baseUrl}}${pmPath}${query.length ? `?${query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`;
      const request: PmRequestObject = {
        method: m.toUpperCase(),
        header,
        url: { raw, host: ['{{baseUrl}}'], path: pmPath.split('/').filter(Boolean), ...(query.length ? { query } : {}), ...(pathVars.length ? { variable: pathVars } : {}) },
        ...(op.description || op.summary ? { description: op.description ?? op.summary } : {}),
      };
      const content = op.requestBody?.content;
      if (content) {
        const [ct, media] = Object.entries(content)[0] ?? [];
        if (ct && media) {
          const example = media.example ?? Object.values(media.examples ?? {})[0]?.value ?? exampleFromSchema(media.schema, doc);
          if (/json/.test(ct)) {
            request.body = { mode: 'raw', raw: JSON.stringify(example ?? {}, null, 2), options: { raw: { language: 'json' } } };
            header.push({ key: 'Content-Type', value: 'application/json' });
          } else if (/x-www-form-urlencoded/.test(ct)) {
            request.body = { mode: 'urlencoded', urlencoded: Object.entries((example as Record<string, unknown>) ?? {}).map(([k, v]) => ({ key: k, value: String(v ?? '') })) };
          } else if (/multipart/.test(ct)) {
            request.body = { mode: 'formdata', formdata: Object.entries((example as Record<string, unknown>) ?? {}).map(([k, v]) => ({ key: k, value: String(v ?? ''), type: 'text' })) };
          } else request.body = { mode: 'raw', raw: typeof example === 'string' ? example : JSON.stringify(example ?? ''), options: { raw: { language: 'text' } } };
        }
      }
      const item: PmItem = { id: uuid(), name: op.summary || op.operationId || `${m.toUpperCase()} ${path}`, request, response: [] };
      const tag = op.tags?.[0];
      if (tag) {
        let f = folders.get(tag);
        if (!f) {
          f = { id: uuid(), name: tag, item: [] };
          folders.set(tag, f);
        }
        f.item.push(item);
      } else root.push(item);
    }
  }
  const col: PmCollection = {
    info: { _postman_id: uuid(), name: doc.info?.title ?? 'OpenAPI import', schema: COLLECTION_SCHEMA_V21, ...(doc.info?.description ? { description: doc.info.description } : {}) },
    item: [...folders.values(), ...root],
    variable,
  };
  // Security: bearer / apiKey at collection level when declared.
  const sec = doc.components?.securitySchemes ?? {};
  const first = Object.values(sec)[0];
  if (first?.type === 'http' && first.scheme === 'bearer') {
    col.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] };
    variable.push({ key: 'token', value: '', type: 'string' });
  } else if (first?.type === 'apiKey' && first.name) {
    col.auth = { type: 'apikey', apikey: [{ key: 'key', value: first.name, type: 'string' }, { key: 'value', value: '{{apiKey}}', type: 'string' }, { key: 'in', value: first.in === 'query' ? 'query' : 'header', type: 'string' }] };
    variable.push({ key: 'apiKey', value: '', type: 'string' });
  }
  return col;
}

export async function parseOpenApiText(text: string): Promise<OpenApiDoc> {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t) as OpenApiDoc;
  const { parse } = await import('yaml');
  return parse(t) as OpenApiDoc;
}
