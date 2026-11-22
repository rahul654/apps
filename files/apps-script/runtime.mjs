// Runs files/apps-script/Code.gs in Node with stand-ins for the Apps Script services it uses
// and an in-memory fake of the Drive REST API it calls through UrlFetchApp. For the tests
// (code.test.mjs) and the local mock server (mock-server.mjs). Node only; not part of the site.
//
// Only what Code.gs uses is faked. Using another Apps Script API or Drive endpoint in Code.gs
// means adding it here, or the tests fail with "not faked".
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

// import.meta.dirname: under vitest's jsdom environment import.meta.url isn't a file: URL.
const SOURCE = readFileSync(join(import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)), 'Code.gs'), 'utf8');
const UNIT = 256 * 1024;

// Apps Script byte arrays are Java bytes: numbers from -128 to 127.
const toJava = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const fromJava = (bytes) => Buffer.from(bytes.map((b) => b & 0xff));

/** Turns a UrlFetchApp payload (string, Java bytes or blob) into a Buffer. */
function payloadBuffer(payload) {
  if (payload === undefined || payload === null) return Buffer.alloc(0);
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  if (Array.isArray(payload)) return fromJava(payload);
  if (typeof payload.getBytes === 'function') return fromJava(payload.getBytes());
  throw new Error('fake UrlFetchApp: unknown payload');
}

function blob(buf, type = '') {
  return {
    getBytes: () => toJava(buf),
    getDataAsString: () => buf.toString('utf8'),
    getContentType: () => type,
  };
}

/** In-memory Drive: files, folders and resumable upload sessions. */
export class FakeDrive {
  constructor({ pageSize = 1000 } = {}) {
    this.files = new Map(); // id → { id, name, mimeType, parents, createdTime, appProperties, description, content, permissions }
    this.sessions = new Map(); // upload_id → { meta, size, type, parts: Buffer[], received }
    this.pageSize = pageSize; // lower it to test paging
    this.failures = []; // queued { match(method, url), code } answers for the next matching calls
    this.calls = [];
    this.clock = 0;
  }

  /** The next `count` calls that match get `code` instead of a real answer. */
  failNext(code, match = () => true, count = 1) {
    for (let i = 0; i < count; i++) this.failures.push({ code, match });
  }

  addFile(meta, content = Buffer.alloc(0)) {
    const id = meta.id ?? randomUUID().replace(/-/g, '').slice(0, 28);
    this.clock = Math.max(this.clock + 1, Date.now()); // real time, but never two files at the same ms
    const createdTime = new Date(this.clock).toISOString();
    const file = { id, parents: [], appProperties: undefined, description: undefined, permissions: [], createdTime, ...meta, content: Buffer.from(content) };
    this.files.set(id, file);
    return file;
  }

  resource(f) {
    const out = { id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, parents: [...f.parents], trashed: false };
    if (f.mimeType !== 'application/vnd.google-apps.folder') out.size = String(f.content.length); // Drive sends size as a string
    if (f.appProperties) out.appProperties = { ...f.appProperties };
    if (f.description !== undefined) out.description = f.description;
    return out;
  }

  fetch(url, params = {}) {
    const method = (params.method || 'get').toLowerCase();
    const headers = Object.fromEntries(Object.entries(params.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    this.calls.push({ method, url });
    if (headers.authorization !== 'Bearer fake-oauth-token') return res(401, {}, '{"error":"no auth"}');
    const failure = this.failures.findIndex((f) => f.match(method, url));
    if (failure >= 0) return res(this.failures.splice(failure, 1)[0].code, {}, '{"error":{"message":"injected failure"}}');

    const u = new URL(url);
    const body = payloadBuffer(params.payload);
    const path = u.pathname;

    if (path === '/drive/v3/files' && method === 'get') {
      const m = /^'([^']+)' in parents and trashed = false$/.exec(u.searchParams.get('q') || '');
      if (!m) return res(400, {}, '{"error":"bad q"}');
      const all = [...this.files.values()].filter((f) => f.parents.includes(m[1])).sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      const start = Number(u.searchParams.get('pageToken') || 0);
      const size = Math.min(Number(u.searchParams.get('pageSize') || 100), this.pageSize);
      const page = all.slice(start, start + size).map((f) => this.resource(f));
      const next = start + size < all.length ? { nextPageToken: String(start + size) } : {};
      return res(200, {}, JSON.stringify({ files: page, ...next }));
    }

    let m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(path);
    if (m) {
      const f = this.files.get(m[1]);
      if (!f) return res(404, {}, '{"error":"not found"}');
      if (method === 'delete') {
        this.files.delete(f.id);
        return res(204, {}, '');
      }
      if (method === 'get' && u.searchParams.get('alt') === 'media') return res(200, { 'Content-Type': f.mimeType }, f.content);
      if (method === 'get') return res(200, {}, JSON.stringify(this.resource(f)));
    }

    m = /^\/drive\/v3\/files\/([\w-]+)\/permissions$/.exec(path);
    if (m && method === 'post') {
      const f = this.files.get(m[1]);
      if (!f) return res(404, {}, '{"error":"not found"}');
      f.permissions.push(JSON.parse(body.toString('utf8')));
      return res(200, {}, '{"id":"anyoneWithLink"}');
    }

    if (path === '/upload/drive/v3/files' && u.searchParams.get('uploadType') === 'multipart' && method === 'post') {
      const boundary = /boundary=([^;]+)/.exec(params.contentType || '')?.[1];
      if (!boundary) return res(400, {}, '{"error":"no boundary"}');
      const parts = splitMultipart(body, boundary);
      if (parts.length !== 2) return res(400, {}, '{"error":"need 2 parts"}');
      const meta = JSON.parse(parts[0].toString('utf8'));
      const f = this.addFile({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], appProperties: meta.appProperties, description: meta.description }, parts[1]);
      return res(200, {}, JSON.stringify(this.resource(f)));
    }

    if (path === '/upload/drive/v3/files' && u.searchParams.get('uploadType') === 'resumable') {
      const sid = u.searchParams.get('upload_id');
      if (!sid && method === 'post') {
        const meta = JSON.parse(body.toString('utf8'));
        const size = Number(headers['x-upload-content-length']);
        const id = randomUUID().replace(/-/g, '');
        this.sessions.set(id, { meta, size, parts: [], received: 0 });
        u.searchParams.set('upload_id', id);
        return res(200, { Location: u.toString() }, '');
      }
      const s = this.sessions.get(sid);
      if (!s) return res(404, {}, '{"error":"no such upload"}');
      if (method === 'delete') {
        this.sessions.delete(sid);
        return res(499, {}, '');
      }
      if (method === 'put') {
        const range = headers['content-range'] || '';
        const status = /^bytes \*\/(\d+)$/.exec(range);
        if (!status) {
          const r = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
          if (!r || Number(r[3]) !== s.size) return res(400, {}, '{"error":"bad range"}');
          const [from, to] = [Number(r[1]), Number(r[2])];
          if (to - from + 1 !== body.length) return res(400, {}, '{"error":"length mismatch"}');
          if (from !== s.received) return res(400, {}, '{"error":"offset mismatch"}');
          if (to + 1 < s.size && body.length % UNIT) return res(400, {}, '{"error":"not a multiple of 256 KiB"}');
          s.parts.push(body);
          s.received += body.length;
        }
        if (s.received === s.size) {
          this.sessions.delete(sid);
          const f = this.addFile({ name: s.meta.name, mimeType: s.meta.mimeType, parents: s.meta.parents || [] }, Buffer.concat(s.parts));
          s.file = f;
          return res(200, {}, JSON.stringify(this.resource(f)));
        }
        return res(308, s.received ? { Range: `bytes=0-${s.received - 1}` } : {}, '');
      }
    }

    throw new Error(`fake Drive: ${method.toUpperCase()} ${url} not faked`);
  }
}

function splitMultipart(buf, boundary) {
  const text = buf.toString('latin1'); // byte-preserving
  const parts = text.split(`--${boundary}`).slice(1, -1);
  return parts.map((p) => {
    const at = p.indexOf('\r\n\r\n');
    return Buffer.from(p.slice(at + 4, p.length - 2), 'latin1');
  });
}

function res(code, headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return {
    getResponseCode: () => code,
    getAllHeaders: () => ({ ...headers }),
    getContentText: () => buf.toString('utf8'),
  };
}

/**
 * Loads Code.gs.
 * @param {{ password?: string, props?: Record<string,string>, clock?: { now: number }, drive?: FakeDrive }} [options]
 */
export function loadFilesScript({ password, props: extra = {}, clock, drive = new FakeDrive() } = {}) {
  const props = new Map(Object.entries(extra));
  if (password !== undefined) props.set('UPLOAD_PASSWORD', password);
  const cache = new Map();
  const now = () => clock?.now ?? Date.now();
  const logs = [];

  class ScriptDate extends Date {
    static now() {
      return now();
    }
  }

  const sandbox = {
    Date: ScriptDate,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    encodeURIComponent,
    Logger: { log: (m) => logs.push(String(m)) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
        getProperties: () => Object.fromEntries(props),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get(k) {
          const e = cache.get(k);
          return e && e.until > now() ? e.value : null;
        },
        put(k, v, seconds = 600) {
          cache.set(k, { value: String(v), until: now() + seconds * 1000 });
        },
        remove(k) {
          cache.delete(k);
        },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getOAuthToken: () => 'fake-oauth-token' },
    UrlFetchApp: { fetch: (url, params) => drive.fetch(url, params) },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      createFolder(name) {
        const f = drive.addFile({ name, mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
        return {
          getId: () => f.id,
          setSharing(access, permission) {
            f.sharing = `${access}:${permission}`;
            return this;
          },
        };
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      computeHmacSha256Signature: (value, key) => toJava(createHmac('sha256', String(key)).update(String(value)).digest()),
      base64EncodeWebSafe: (bytes) => fromJava(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: (text) => {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) throw new Error('Could not decode string.');
        return toJava(Buffer.from(text, 'base64'));
      },
      newBlob: (data, type) => blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : fromJava(data), type),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, mimeType: 'text/plain', setMimeType(m) { this.mimeType = m; return this; } }),
    },
  };
  createContext(sandbox);
  runInContext(SOURCE, sandbox, { filename: 'Code.gs' });

  const parse = (out) => JSON.parse(out.text);
  return {
    drive,
    props,
    logs,
    get: () => parse(sandbox.doGet({})),
    post: (body) => parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })),
    run: (fn) => sandbox[fn](),
  };
}
