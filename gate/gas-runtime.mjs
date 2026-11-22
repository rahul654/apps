// Runs gate/apps-script.gs in Node with small stand-ins for the Apps Script services it uses
// (PropertiesService, CacheService, LockService, Utilities, ContentService), for the tests and
// the local mock server (gate/mock-server.mjs). Node only; not part of the site.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const SOURCE = readFileSync(new URL('./apps-script.gs', import.meta.url), 'utf8');

/**
 * @param {{ password?: string, clock?: { now: number } }} [options]
 *   clock.now can be moved forward by tests; it defaults to the real time.
 */
export function loadAppsScript({ password, clock } = {}) {
  const props = new Map(password === undefined ? [] : [['PASSWORD', password]]);
  const cache = new Map(); // key → { value, until }
  const now = () => clock?.now ?? Date.now();

  // Apps Script returns Java byte arrays: numbers from -128 to 127.
  const toJavaBytes = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
  const fromJavaBytes = (bytes) => Buffer.from(bytes.map((b) => b & 0xff));

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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
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
    Utilities: {
      getUuid: () => randomUUID(),
      computeHmacSha256Signature: (value, key) => toJavaBytes(createHmac('sha256', String(key)).update(String(value)).digest()),
      base64EncodeWebSafe: (bytes) => fromJavaBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, mimeType: 'text/plain', setMimeType(m) { this.mimeType = m; return this; } }),
    },
  };
  createContext(sandbox);
  runInContext(SOURCE, sandbox, { filename: 'apps-script.gs' });

  const parse = (out) => ({ ...JSON.parse(out.text), mimeType: out.mimeType });
  return {
    props,
    get: () => parse(sandbox.doGet({})),
    post: (body) => parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })),
  };
}
