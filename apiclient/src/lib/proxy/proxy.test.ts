/** Spawns the real proxy script against a local test server (no CORS, Set-Cookie, gzip, redirects). */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PROXY_PORT = 4326;
const UPSTREAM_PORT = 4325;
const script = fileURLToPath(new URL('../../../proxy/apiclient-proxy.mjs', import.meta.url));
let proxy: ChildProcess;
let upstream: http.Server;
const ORIGIN = 'http://localhost:4324';

function waitFor(url: string, tries = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      http.get(url, { headers: { origin: ORIGIN } }, (res) => {
        res.resume();
        resolve();
      }).on('error', () => (n > 0 ? setTimeout(() => attempt(n - 1), 100) : reject(new Error('proxy did not start'))));
    };
    attempt(tries);
  });
}

async function send(payload: unknown, origin: string | null = ORIGIN) {
  const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/send`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(payload) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (req.url === '/cookie') {
        res.setHeader('Set-Cookie', ['a=1; Path=/; HttpOnly', 'b=2']);
        res.setHeader('x-dup', ['one', 'two']);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ method: req.method, body, cookie: req.headers.cookie ?? null, ua: req.headers['user-agent'], host: req.headers.host }));
      }
      if (req.url === '/gzip') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        return res.end(zlib.gzipSync('compressed hello'));
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/cookie' });
        return res.end();
      }
      if (req.url === '/slow') return setTimeout(() => res.end('late'), 60);
      res.writeHead(404);
      res.end('nope');
    });
  });
  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));
  proxy = spawn(process.execPath, [script, '--port', String(PROXY_PORT), '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(`http://127.0.0.1:${PROXY_PORT}/ping`);
});

afterAll(async () => {
  proxy.kill();
  await new Promise<void>((r) => upstream.close(() => r()));
});

describe('apiclient-proxy', () => {
  it('answers ping with CORS headers for an allowed origin', async () => {
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/ping`, { headers: { origin: ORIGIN } });
    expect(await res.json()).toEqual({ ok: true, name: 'apiclient-proxy', version: '1.1.0', pid: proxy.pid });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const pre = await fetch(`http://127.0.0.1:${PROXY_PORT}/send`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(pre.headers.get('access-control-allow-private-network')).toBeNull();
  });
  it('opts in to Chrome private-network preflights from an allowed public origin', async () => {
    const pre = await fetch(`http://127.0.0.1:${PROXY_PORT}/send`, {
      method: 'OPTIONS',
      headers: { origin: 'https://rahul654.github.io', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-private-network')).toBe('true');
  });
  it('refuses unknown or missing origins', async () => {
    expect((await send({ url: 'http://x' }, 'https://evil.example')).status).toBe(403);
    expect((await send({ url: 'http://x' }, null)).status).toBe(403);
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/ping`, { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('forwards method, forbidden headers and body; returns Set-Cookie, duplicate headers and timings', async () => {
    const { status, json } = await send({ method: 'POST', url: `http://127.0.0.1:${UPSTREAM_PORT}/cookie`, headers: [['Cookie', 'sid=1'], ['User-Agent', 'custom-ua'], ['Host', 'fake.host']], body: Buffer.from('hello').toString('base64') });
    expect(status).toBe(200);
    expect(json.status).toBe(200);
    const body = JSON.parse(Buffer.from(json.body as string, 'base64').toString());
    expect(body).toEqual({ method: 'POST', body: 'hello', cookie: 'sid=1', ua: 'custom-ua', host: 'fake.host' });
    expect(json.setCookie).toEqual(['a=1; Path=/; HttpOnly', 'b=2']);
    const headers = json.headers as [string, string][];
    expect(headers.filter(([k]) => k.toLowerCase() === 'x-dup').map(([, v]) => v)).toEqual(['one', 'two']);
    const t = json.timings as Record<string, number>;
    for (const k of ['dns', 'connect', 'tls', 'ttfb', 'download', 'total']) expect(typeof t[k]).toBe('number');
    expect(t.total).toBeGreaterThan(0);
    expect(t.ttfb).toBeGreaterThanOrEqual(0);
  });
  it('decompresses gzip and says so, follows redirects, measures slow TTFB', async () => {
    const gz = await send({ url: `http://127.0.0.1:${UPSTREAM_PORT}/gzip`, headers: [] });
    expect(Buffer.from(gz.json.body as string, 'base64').toString()).toBe('compressed hello');
    expect((gz.json.headers as [string, string][]).some(([k, v]) => k === 'x-apiclient-decoded-encoding' && v === 'gzip')).toBe(true);
    const re = await send({ url: `http://127.0.0.1:${UPSTREAM_PORT}/redirect`, headers: [] });
    expect(re.json.status).toBe(200);
    expect(re.json.redirects).toEqual([{ status: 302, url: `http://127.0.0.1:${UPSTREAM_PORT}/redirect` }]);
    expect(re.json.finalUrl).toBe(`http://127.0.0.1:${UPSTREAM_PORT}/cookie`);
    const slow = await send({ url: `http://127.0.0.1:${UPSTREAM_PORT}/slow`, headers: [] });
    expect((slow.json.timings as { ttfb: number }).ttfb).toBeGreaterThanOrEqual(50);
  });
  it('reports upstream failures as 502 with a message, and bad input as 400', async () => {
    const down = await send({ url: 'http://127.0.0.1:1/x', headers: [] });
    expect(down.status).toBe(502);
    expect(String(down.json.error)).toMatch(/ECONNREFUSED/);
    expect((await send({ nope: 1 })).status).toBe(400);
    const bad = await fetch(`http://127.0.0.1:${PROXY_PORT}/send`, { method: 'POST', headers: { origin: ORIGIN }, body: '{' });
    expect(bad.status).toBe(400);
    expect((await send({ url: 'ftp://x/', headers: [] })).status).toBe(502);
  });
});

/** Spawns the proxy and resolves with its exit code and output once it either listens or exits. */
function startProxy(port: number): Promise<{ child: ChildProcess; listening: boolean; code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d: Buffer) => {
      out += d.toString();
      if (out.includes('listening on')) resolve({ child, listening: true, code: null, out });
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.once('exit', (code) => resolve({ child, listening: false, code, out }));
  });
}

describe('apiclient-proxy port handling', () => {
  it('a new run on the same port stops the running proxy and takes over', async () => {
    const oldExit = new Promise<number | null>((r) => proxy.once('exit', (code) => r(code)));
    const next = await startProxy(PROXY_PORT);
    expect(next.listening).toBe(true);
    expect(next.out).toMatch(/already running on port 4326; stopping it/);
    expect(await oldExit).toBe(0);
    const ping = await (await fetch(`http://127.0.0.1:${PROXY_PORT}/ping`, { headers: { origin: ORIGIN } })).json();
    expect(ping.pid).toBe(next.child.pid);
    proxy = next.child; // later tests (and afterAll) use the new one
  });

  it('leaves a port held by another program alone and explains', async () => {
    const other = http.createServer((_q, r) => r.end('not a proxy'));
    await new Promise<void>((r) => other.listen(4327, '127.0.0.1', r));
    try {
      const run = await startProxy(4327);
      expect(run.listening).toBe(false);
      expect(run.code).toBe(1);
      expect(run.out).toMatch(/used by another program/);
      expect(await (await fetch('http://127.0.0.1:4327/')).text()).toBe('not a proxy');
    } finally {
      await new Promise<void>((r) => other.close(() => r()));
    }
  });
});

// Runs last: it stops the proxy.
describe('apiclient-proxy shutdown', () => {
  it('ignores /shutdown from other origins, then exits when the app asks', async () => {
    const refused = await fetch(`http://127.0.0.1:${PROXY_PORT}/shutdown`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(refused.status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${PROXY_PORT}/ping`, { headers: { origin: ORIGIN } })).status).toBe(200);

    const exited = new Promise<number | null>((r) => proxy.once('exit', (code) => r(code)));
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/shutdown`, { method: 'POST', headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await exited).toBe(0);
    await expect(fetch(`http://127.0.0.1:${PROXY_PORT}/ping`, { headers: { origin: ORIGIN } })).rejects.toThrow();
  });
});
