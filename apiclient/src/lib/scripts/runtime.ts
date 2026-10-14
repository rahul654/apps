/**
 * The script sandbox. `sandboxMain` is stringified into a sandboxed iframe (opaque origin,
 * allow-scripts only), so it must stay self-contained: no imports, no outer variables.
 * It is also called directly in unit tests with a fake message channel.
 *
 * Supported pm API: pm.environment / pm.globals / pm.collectionVariables / pm.variables
 * (get, set, unset, has, toObject, clear, replaceIn), pm.iterationData (get, has, toObject),
 * pm.request (method, url, headers.add/upsert/remove/get/has, body), pm.response (code, status,
 * headers.get/has, json(), text(), responseTime, responseSize, to.have.status/header/jsonBody/body,
 * to.be.ok/success/error/clientError/serverError/json), pm.test (sync or async), pm.expect (chai),
 * pm.sendRequest, pm.info, pm.execution.setNextRequest, postman.setNextRequest, console.*,
 * and the legacy `tests[...]`, `responseBody`, `responseCode`, `postman.setEnvironmentVariable`.
 */
import type { FromSandbox, ToSandbox } from './types';

export interface SandboxEnv {
  chai: unknown;
  post: (msg: FromSandbox) => void;
  onMessage: (handler: (msg: ToSandbox) => void) => void;
}

export function sandboxMain(env: SandboxEnv): void {
  type Dict = Record<string, string>;
  const chai = env.chai as { expect: (...a: unknown[]) => unknown };
  const pendingFetches = new Map<string, (res: unknown) => void>();
  let seq = 0;

  function str(x: unknown): string {
    if (typeof x === 'string') return x;
    if (x instanceof Error) return x.stack || String(x);
    try {
      return JSON.stringify(x, null, 2) ?? String(x);
    } catch {
      return String(x);
    }
  }

  function makeScope(dict: Dict, allScopes: () => Dict[]) {
    return {
      get: (k: string) => (Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : undefined),
      set: (k: string, v: unknown) => {
        dict[k] = typeof v === 'string' ? v : v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      },
      unset: (k: string) => {
        delete dict[k];
      },
      has: (k: string) => Object.prototype.hasOwnProperty.call(dict, k),
      toObject: () => ({ ...dict }),
      clear: () => {
        for (const k of Object.keys(dict)) delete dict[k];
      },
      replaceIn: (s: string) => replaceIn(String(s), allScopes()),
    };
  }

  function replaceIn(s: string, scopes: Dict[]): string {
    let out = s;
    for (let i = 0; i < 10; i++) {
      let changed = false;
      out = out.replace(/\{\{([^{}]+)\}\}/g, (whole, name: string) => {
        const n = name.trim();
        if (n === '$guid' || n === '$randomUUID') {
          changed = true;
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          });
        }
        if (n === '$timestamp') {
          changed = true;
          return String(Math.floor(Date.now() / 1000));
        }
        if (n === '$isoTimestamp') {
          changed = true;
          return new Date().toISOString();
        }
        if (n === '$randomInt') {
          changed = true;
          return String(Math.floor(Math.random() * 1001));
        }
        for (const sc of scopes) if (Object.prototype.hasOwnProperty.call(sc, n)) {
          changed = true;
          return sc[n];
        }
        return whole;
      });
      if (!changed) break;
    }
    return out;
  }

  function headerList(list: { key: string; value: string }[]) {
    return {
      list,
      get: (name: string) => list.find((h) => h.key.toLowerCase() === String(name).toLowerCase())?.value,
      has: (name: string, value?: string) => {
        const h = list.find((x) => x.key.toLowerCase() === String(name).toLowerCase());
        return !!h && (value === undefined || h.value === String(value));
      },
      add: (h: { key: string; value: string } | string, value?: string) => {
        if (typeof h === 'string') list.push({ key: h, value: String(value ?? '') });
        else list.push({ key: String(h.key), value: String(h.value ?? '') });
      },
      upsert: (h: { key: string; value: string } | string, value?: string) => {
        const key = typeof h === 'string' ? h : String(h.key);
        const val = typeof h === 'string' ? String(value ?? '') : String(h.value ?? '');
        const i = list.findIndex((x) => x.key.toLowerCase() === key.toLowerCase());
        if (i >= 0) list[i] = { key: list[i].key, value: val };
        else list.push({ key, value: val });
      },
      remove: (name: string) => {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].key.toLowerCase() === String(name).toLowerCase()) list.splice(i, 1);
      },
      toObject: () => Object.fromEntries(list.map((h) => [h.key, h.value])),
      each: (fn: (h: { key: string; value: string }) => void) => list.forEach(fn),
      count: () => list.length,
    };
  }

  function run(payload: ToSandbox & { type: 'run' }): void {
    const p = payload.payload;
    const id = p.id;
    const tests: { name: string; passed: boolean; error?: string }[] = [];
    const consoleLines: { level: 'log' | 'info' | 'warn' | 'error' | 'debug'; args: string[] }[] = [];
    const vars = { globals: { ...p.variables.globals }, environment: { ...p.variables.environment }, collection: { ...p.variables.collection }, local: { ...p.variables.local } };
    const data = { ...p.variables.data };
    const order = () => [vars.local, data, vars.environment, vars.collection, vars.globals];
    const request = { ...p.request, headers: p.request.headers.map((h) => ({ ...h })) };
    let nextRequest: string | null | undefined = undefined;
    let pending = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const deadline = p.timeout ?? 10000;

    const done = (error?: string) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      env.post({ type: 'done', id, result: { tests, console: consoleLines, variables: vars, nextRequest, request: { ...request, headers: request.headers.map((h) => ({ ...h })) }, ...(error ? { error } : {}) } });
    };
    const maybeDone = () => {
      // Let microtasks (async tests, fetch callbacks) settle before deciding we are idle.
      Promise.resolve().then(() => {
        if (pending === 0 && !finished) done();
      });
    };

    const fakeConsole = {
      log: (...a: unknown[]) => consoleLines.push({ level: 'log', args: a.map(str) }),
      info: (...a: unknown[]) => consoleLines.push({ level: 'info', args: a.map(str) }),
      warn: (...a: unknown[]) => consoleLines.push({ level: 'warn', args: a.map(str) }),
      error: (...a: unknown[]) => consoleLines.push({ level: 'error', args: a.map(str) }),
      debug: (...a: unknown[]) => consoleLines.push({ level: 'debug', args: a.map(str) }),
    };

    const resp = p.response;
    const respHeaders = headerList(resp ? resp.headers.map((h) => ({ ...h })) : []);
    let jsonCache: { v: unknown } | null = null;
    const json = () => {
      if (!resp) throw new Error('pm.response is only available in post-response (test) scripts');
      if (!jsonCache) jsonCache = { v: JSON.parse(resp.body) };
      return jsonCache.v;
    };
    const expect = chai.expect as (v: unknown, m?: string) => unknown;
    class SandboxAssertionError extends Error {
      constructor(m: string) {
        super(m);
        this.name = 'AssertionError';
      }
    }
    const assert = (cond: boolean, msg: string) => {
      if (!cond) throw new SandboxAssertionError(msg);
    };
    const statusText = (code: number) =>
      ({ 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' })[code] ?? '';
    const pathGet = (obj: unknown, path: string): unknown => {
      let cur: unknown = obj;
      for (const seg of path.split(/\.|\[|\]/).filter(Boolean)) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
      }
      return cur;
    };
    const makeTo = (neg: boolean) => {
      const check = (cond: boolean, msg: string) => assert(neg ? !cond : cond, (neg ? 'expected not: ' : '') + msg);
      return {
        have: {
          status: (s: number | string) => {
            if (!resp) throw new Error('no response');
            if (typeof s === 'number') check(resp.code === s, `expected response to have status code ${s} but got ${resp.code}`);
            else check((resp.status || statusText(resp.code)) === s, `expected response to have status reason '${s}' but got '${resp.status}'`);
          },
          header: (name: string, value?: string) => check(respHeaders.has(name, value), `expected response to have header with key '${name}'${value !== undefined ? ` and value '${value}'` : ''}`),
          jsonBody: (path?: string, value?: unknown) => {
            let j: unknown;
            try {
              j = json();
            } catch {
              check(false, 'expected response body to be valid json');
              return;
            }
            if (path === undefined) return check(true, 'expected response to have json body');
            const got = pathGet(j, path);
            if (value === undefined) check(got !== undefined, `expected response json to have property '${path}'`);
            else check(JSON.stringify(got) === JSON.stringify(value), `expected response json property '${path}' to equal ${JSON.stringify(value)} but got ${JSON.stringify(got)}`);
          },
          body: (b?: string | RegExp) => {
            if (!resp) throw new Error('no response');
            if (b === undefined) check(resp.body.length > 0, 'expected response to have a body');
            else if (b instanceof RegExp) check(b.test(resp.body), `expected response body to match ${b}`);
            else check(resp.body === b, `expected response body to equal '${b}'`);
          },
          jsonSchema: () => {
            throw new Error('pm.response.to.have.jsonSchema is not supported here');
          },
        },
        be: {
          get ok() {
            check(!!resp && resp.code >= 200 && resp.code < 300, `expected response code to be 2XX but found ${resp?.code}`);
            return true;
          },
          get success() {
            check(!!resp && resp.code >= 200 && resp.code < 300, `expected response code to be 2XX but found ${resp?.code}`);
            return true;
          },
          get error() {
            check(!!resp && resp.code >= 400, `expected response code to be 4XX or 5XX but found ${resp?.code}`);
            return true;
          },
          get clientError() {
            check(!!resp && resp.code >= 400 && resp.code < 500, `expected response code to be 4XX but found ${resp?.code}`);
            return true;
          },
          get serverError() {
            check(!!resp && resp.code >= 500, `expected response code to be 5XX but found ${resp?.code}`);
            return true;
          },
          get json() {
            let ok = true;
            try {
              json();
            } catch {
              ok = false;
            }
            check(ok, 'expected response body to be valid json');
            return true;
          },
          get redirection() {
            check(!!resp && resp.code >= 300 && resp.code < 400, `expected response code to be 3XX but found ${resp?.code}`);
            return true;
          },
        },
      };
    };

    const sendRequestImpl = (reqIn: unknown, cb?: (err: unknown, res?: unknown) => void): Promise<unknown> => {
      const r = typeof reqIn === 'string' ? { url: reqIn } : (reqIn as Record<string, unknown>);
      const headersIn = r.header ?? r.headers;
      const headers: { key: string; value: string }[] = [];
      if (Array.isArray(headersIn)) for (const h of headersIn) headers.push({ key: String((h as { key: string }).key), value: String((h as { value: string }).value ?? '') });
      else if (headersIn && typeof headersIn === 'object') for (const [k, v] of Object.entries(headersIn)) headers.push({ key: k, value: String(v) });
      let body: string | null = null;
      const b = r.body as Record<string, unknown> | string | undefined;
      if (typeof b === 'string') body = b;
      else if (b && typeof b === 'object') {
        if (b.mode === 'raw') body = String(b.raw ?? '');
        else if (b.mode === 'urlencoded' && Array.isArray(b.urlencoded)) {
          body = (b.urlencoded as { key: string; value: string }[]).map((e) => `${encodeURIComponent(e.key)}=${encodeURIComponent(e.value ?? '')}`).join('&');
          if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
        } else if (b.mode === 'graphql') {
          body = JSON.stringify(b.graphql ?? {});
          if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
        }
      }
      const reqId = `f${++seq}`;
      pending++;
      const promise = new Promise<unknown>((resolve, reject) => {
        pendingFetches.set(reqId, (res) => {
          pendingFetches.delete(reqId);
          const rr = res as { code: number; status: string; headers: { key: string; value: string }[]; body: string; responseTime: number; error?: string };
          const wrapped = rr.error
            ? undefined
            : {
                code: rr.code,
                status: rr.status,
                headers: headerList(rr.headers),
                responseTime: rr.responseTime,
                json: () => JSON.parse(rr.body),
                text: () => rr.body,
                stream: rr.body,
              };
          const err = rr.error ? new Error(rr.error) : null;
          try {
            if (cb) cb(err, wrapped);
            if (err) reject(err);
            else resolve(wrapped);
          } catch (e) {
            consoleLines.push({ level: 'error', args: [str(e)] });
            reject(e);
          } finally {
            pending--;
            maybeDone();
          }
        });
      });
      promise.catch(() => undefined);
      env.post({ type: 'fetch', id, reqId, request: { method: String(r.method ?? 'GET').toUpperCase(), url: replaceIn(String(r.url ?? ''), order()), headers, body } });
      return promise;
    };

    const pmTest = (name: string, fn: () => unknown) => {
      let result: unknown;
      try {
        result = fn();
      } catch (e) {
        tests.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        pending++;
        const entry = { name, passed: true } as { name: string; passed: boolean; error?: string };
        tests.push(entry);
        (result as Promise<unknown>).then(
          () => {
            pending--;
            maybeDone();
          },
          (e: unknown) => {
            entry.passed = false;
            entry.error = e instanceof Error ? e.message : String(e);
            pending--;
            maybeDone();
          },
        );
        return;
      }
      tests.push({ name, passed: true });
    };
    (pmTest as unknown as { skip: (name: string) => void }).skip = (name: string) => tests.push({ name: `${name} (skipped)`, passed: true });

    const pm = {
      info: { ...p.info },
      globals: makeScope(vars.globals, order),
      environment: makeScope(vars.environment, order),
      collectionVariables: makeScope(vars.collection, order),
      variables: {
        ...makeScope(vars.local, order),
        get: (k: string) => {
          for (const sc of order()) if (Object.prototype.hasOwnProperty.call(sc, k)) return sc[k];
          return undefined;
        },
        has: (k: string) => order().some((sc) => Object.prototype.hasOwnProperty.call(sc, k)),
        toObject: () => Object.assign({}, ...order().slice().reverse()) as Dict,
      },
      iterationData: { get: (k: string) => data[k], has: (k: string) => Object.prototype.hasOwnProperty.call(data, k), toObject: () => ({ ...data }), toJSON: () => ({ ...data }) },
      request: {
        get method() {
          return request.method;
        },
        set method(m: string) {
          request.method = String(m).toUpperCase();
        },
        get url() {
          const u = request.url;
          return { toString: () => u, toJSON: () => u, update: (n: string) => (request.url = String(n)) };
        },
        set url(u: unknown) {
          request.url = String(u);
        },
        headers: headerList(request.headers),
        get body() {
          return { mode: request.body === null ? undefined : 'raw', raw: request.body, toString: () => request.body ?? '', update: (b: unknown) => (request.body = typeof b === 'string' ? b : b && typeof b === 'object' && 'raw' in b ? String((b as { raw: unknown }).raw) : JSON.stringify(b)) };
        },
        name: request.name,
        id: request.id,
        addHeader: (h: { key: string; value: string }) => request.headers.push({ key: String(h.key), value: String(h.value) }),
        removeHeader: (k: string) => {
          for (let i = request.headers.length - 1; i >= 0; i--) if (request.headers[i].key.toLowerCase() === String(k).toLowerCase()) request.headers.splice(i, 1);
        },
      },
      response: resp
        ? {
            code: resp.code,
            status: resp.status || statusText(resp.code),
            headers: respHeaders,
            responseTime: resp.responseTime,
            responseSize: resp.responseSize,
            json,
            text: () => resp.body,
            stream: resp.body,
            get to() {
              const to = makeTo(false) as ReturnType<typeof makeTo> & { not: ReturnType<typeof makeTo> };
              to.not = makeTo(true);
              return to;
            },
            reason: () => resp.status || statusText(resp.code),
            dataURI: () => `data:text/plain,${encodeURIComponent(resp.body)}`,
          }
        : undefined,
      test: pmTest,
      expect,
      sendRequest: sendRequestImpl,
      execution: {
        setNextRequest: (n: string | null) => {
          nextRequest = n;
        },
      },
    };
    const legacyTests: Record<string, unknown> = {};
    const postman = {
      setNextRequest: (n: string | null) => {
        nextRequest = n;
      },
      setEnvironmentVariable: (k: string, v: unknown) => pm.environment.set(k, v),
      getEnvironmentVariable: (k: string) => pm.environment.get(k),
      clearEnvironmentVariable: (k: string) => pm.environment.unset(k),
      setGlobalVariable: (k: string, v: unknown) => pm.globals.set(k, v),
      getGlobalVariable: (k: string) => pm.globals.get(k),
      clearGlobalVariable: (k: string) => pm.globals.unset(k),
    };

    timer = setTimeout(() => done(`Script timed out after ${deadline} ms`), deadline);
    try {
      const fn = new Function(
        'pm',
        'postman',
        'console',
        'tests',
        'responseBody',
        'responseCode',
        'responseHeaders',
        'request',
        'environment',
        'globals',
        'iteration',
        'data',
        `"use strict";\n${p.script}`,
      ) as (...a: unknown[]) => unknown;
      const ret = fn(
        pm,
        postman,
        fakeConsole,
        legacyTests,
        resp?.body ?? '',
        resp ? { code: resp.code, name: resp.status || statusText(resp.code) } : undefined,
        resp ? respHeaders.toObject() : {},
        { method: request.method, url: request.url, headers: Object.fromEntries(request.headers.map((h) => [h.key, h.value])), name: request.name, id: request.id, data: request.body },
        vars.environment,
        vars.globals,
        p.info.iteration,
        data,
      );
      if (ret && typeof (ret as Promise<unknown>).then === 'function') {
        pending++;
        (ret as Promise<unknown>).then(
          () => {
            pending--;
            maybeDone();
          },
          (e: unknown) => {
            pending--;
            done(str(e));
          },
        );
      }
    } catch (e) {
      for (const [name, v] of Object.entries(legacyTests)) tests.push({ name, passed: !!v });
      done(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      return;
    }
    for (const [name, v] of Object.entries(legacyTests)) tests.push({ name, passed: !!v });
    void started;
    maybeDone();
  }

  env.onMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'run') run(msg);
    else if (msg.type === 'fetchResult') pendingFetches.get(msg.reqId)?.(msg.response);
  });
  env.post({ type: 'ready' });
}
