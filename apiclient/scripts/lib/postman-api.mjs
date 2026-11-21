/**
 * Shared by export-from-postman.mjs and import-to-postman.mjs. The build bundles each script with
 * this file and its dependencies into one standalone file (see vite.config.ts), so the web page's
 * one-line commands work without npm install.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

export const API = (process.env.POSTMAN_API_URL || 'https://api.getpostman.com').replace(/\/$/, '');
export const KEYS_PAGE = 'https://postman.co/settings/me/api-keys';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One clear line instead of a stack trace for anything unexpected (network down, bad input…).
process.on('uncaughtException', (e) => {
  console.error(`\n✖ ${e?.message ?? e}`);
  process.exit(1);
});

/** Reads a line from the terminal without echoing it. Ctrl+C aborts. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    function onData(chunk) {
      // Strip bracketed-paste and other escape sequences some terminals send around a paste.
      for (const ch of chunk.replace(/\x1b\[[0-9;]*[~A-Za-z]/g, '')) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stderr.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    }
    stdin.on('data', onData);
  });
}

/**
 * The API key: POSTMAN_API_KEY if set, otherwise asked for at a hidden prompt, so it never lands
 * in the command line or shell history.
 */
export async function readApiKey() {
  let key = (process.env.POSTMAN_API_KEY || '').trim();
  if (!key) {
    if (!process.stdin.isTTY) {
      console.error(`No API key. Run this in a terminal (it asks for the key), or set POSTMAN_API_KEY. Create a key at ${KEYS_PAGE}`);
      process.exit(2);
    }
    key = await promptHidden(`Paste your Postman API key (input hidden; create one at ${KEYS_PAGE}): `);
  }
  if (!/^PMAK-[\w-]+$/.test(key)) {
    console.error('That doesn’t look like a Postman API key (they start with "PMAK-").');
    process.exit(2);
  }
  return key;
}

/** A minimal Postman API client with retries on rate limits (429) and server errors. */
export function createApi(key) {
  let calls = 0;
  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      calls++;
      let res;
      try {
        res = await fetch(API + path, {
          method,
          headers: { 'X-Api-Key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new Error(`Can't reach the Postman API at ${API} (${e.cause?.code ?? e.cause?.message ?? e.message}). Check your internet connection or proxy.`);
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 5) throw new Error(`${method} ${path}: HTTP ${res.status} after ${attempt} retries`);
        const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 2000 * 2 ** attempt;
        console.error(`  ${res.status} on ${path}, waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (!res.ok) {
        const msg = json?.error?.message || json?.error?.name || text.slice(0, 200);
        if (res.status === 401) throw new Error(`The API key was rejected (401). Check it, or create a new one at ${KEYS_PAGE}`);
        throw new Error(`${method} ${path}: HTTP ${res.status} ${msg}`);
      }
      return json;
    }
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    get calls() {
      return calls;
    },
  };
}

/** Reads a zip, a folder (recursively) or a single file into [{ path, text }] with '/'-separated paths. */
export function readInput(input) {
  const st = statSync(input);
  if (st.isDirectory()) {
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else out.push({ path: relative(input, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
      }
    };
    walk(input);
    return out;
  }
  const bytes = readFileSync(input);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return Object.entries(unzipSync(new Uint8Array(bytes)))
      .filter(([name]) => !name.endsWith('/'))
      .map(([path, data]) => ({ path, text: strFromU8(data) }));
  }
  return [{ path: input.split(sep).pop(), text: bytes.toString('utf8') }];
}

/** What a JSON file is, by content. */
export function classify(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.info && Array.isArray(json.item) && /collection/i.test(String(json.info.schema ?? 'collection'))) return 'collection';
  if (json._postman_variable_scope === 'globals') return 'globals';
  if (json._postman_variable_scope === 'environment') return 'environment';
  if (typeof json.name === 'string' && Array.isArray(json.values) && !json.info) return 'environment';
  return null;
}
