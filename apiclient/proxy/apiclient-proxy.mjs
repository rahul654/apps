#!/usr/bin/env node
/**
 * API Client local proxy — dependency-free. Run:  node apiclient-proxy.mjs [--port 4399] [--allow origin,origin]
 *
 * If another run of this proxy already holds the port, the new one stops it and takes over.
 * A different program on the port is never touched; pick another --port instead.
 *
 * Lets the browser app send requests that a web page cannot: to servers without CORS, with
 * forbidden headers (Cookie, Host, User-Agent, Origin…), and it returns the full response
 * including Set-Cookie, plus a timing breakdown (DNS, connect, TLS, TTFB, download).
 *
 * It listens on 127.0.0.1 only and accepts requests only from allowed origins
 * (default: http://localhost:*, http://127.0.0.1:*, https://rahul654.github.io).
 *
 * Endpoints:  GET /ping       → {ok, name, version, pid}
 *             POST /send      → {method, url, headers:[[k,v]], body?: base64} → {status, statusText, headers, setCookie, body, timings}
 *             POST /shutdown  → {ok: true}, then the proxy exits (used by the app's Stop button)
 *
 * The app's Start button needs the one-time launcher: proxy/install-launcher.sh (Linux).
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { URL } from 'node:url';

const VERSION = '1.1.0';
const MAX_BODY = 50 * 1024 * 1024;
const MAX_REDIRECTS = 10;

function parseArgs(argv) {
  const out = { port: Number(process.env.APICLIENT_PROXY_PORT) || 4399, allow: null, host: '127.0.0.1', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a === '--allow') out.allow = argv[++i];
    else if (a.startsWith('--allow=')) out.allow = a.slice(8);
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node apiclient-proxy.mjs [--port 4399] [--allow http://localhost:*,https://example.com] [--quiet]');
      process.exit(0);
    }
  }
  if (!out.allow) out.allow = process.env.APICLIENT_PROXY_ALLOW || 'http://localhost:*,http://127.0.0.1:*,https://rahul654.github.io';
  return out;
}

export function originAllowed(origin, patterns) {
  if (!origin) return false;
  return patterns.some((p) => {
    const pat = p.trim();
    if (!pat) return false;
    if (pat === '*') return true;
    if (pat.endsWith(':*')) {
      const base = pat.slice(0, -2);
      return origin === base || origin.startsWith(base + ':');
    }
    return origin === pat;
  });
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']);

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`Body larger than ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decompress(buf, encoding) {
  const enc = (encoding || '').toLowerCase().trim();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return { body: zlib.gunzipSync(buf), decoded: true };
    if (enc === 'deflate') return { body: zlib.inflateSync(buf), decoded: true };
    if (enc === 'br') return { body: zlib.brotliDecompressSync(buf), decoded: true };
    if (enc === 'zstd' && zlib.zstdDecompressSync) return { body: zlib.zstdDecompressSync(buf), decoded: true };
  } catch {
    /* leave as-is */
  }
  return { body: buf, decoded: false };
}

/** One hop. Resolves with the raw response and timing phases in ms. */
function hop(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new Error(`Unsupported protocol: ${url.protocol}`));
    const mod = url.protocol === 'https:' ? https : http;
    const t = { start: performance.now(), lookup: 0, connect: 0, secure: 0, first: 0, end: 0 };
    const req = mod.request(url, { method, headers, agent: false, rejectUnauthorized: false, timeout: 120000 }, (res) => {
      t.first = performance.now();
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      res.on('end', () => {
        t.end = performance.now();
        const dnsEnd = t.lookup || t.start;
        const connEnd = t.connect || dnsEnd;
        const tlsEnd = t.secure || connEnd;
        resolve({
          res,
          body: Buffer.concat(chunks),
          truncated: size > MAX_BODY,
          timings: {
            dns: round(dnsEnd - t.start),
            connect: round(connEnd - dnsEnd),
            tls: round(tlsEnd - connEnd),
            ttfb: round(t.first - tlsEnd),
            download: round(t.end - t.first),
            total: round(t.end - t.start),
          },
        });
      });
      res.on('error', reject);
    });
    req.on('socket', (socket) => {
      if (socket.connecting === false && !socket.pending) {
        // Reused or already-open socket: no DNS/connect phases to measure.
        t.lookup = t.connect = t.secure = performance.now();
        return;
      }
      socket.once('lookup', () => (t.lookup = performance.now()));
      socket.once('connect', () => (t.connect = performance.now()));
      socket.once('secureConnect', () => (t.secure = performance.now()));
    });
    req.on('timeout', () => req.destroy(new Error('Upstream request timed out')));
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

const round = (n) => Math.round(n * 100) / 100;

export async function forward(payload) {
  let { method = 'GET', url, headers = [], body } = payload;
  method = String(method).toUpperCase();
  let bodyBuf = body ? Buffer.from(body, 'base64') : null;
  const hdrs = {};
  for (const [k, v] of headers) {
    if (!k || HOP_BY_HOP.has(k.toLowerCase())) continue;
    const key = k.toLowerCase();
    hdrs[key] = hdrs[key] !== undefined ? `${hdrs[key]}, ${v}` : String(v);
  }
  if (!hdrs['accept-encoding']) hdrs['accept-encoding'] = 'gzip, deflate, br';
  if (!hdrs['user-agent']) hdrs['user-agent'] = `apiclient-proxy/${VERSION}`;
  if (bodyBuf && !hdrs['content-length']) hdrs['content-length'] = String(bodyBuf.length);
  const total = { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0, total: 0 };
  const redirects = [];
  for (let n = 0; ; n++) {
    const r = await hop(method, url, hdrs, bodyBuf);
    for (const k of Object.keys(total)) total[k] = round(total[k] + r.timings[k]);
    const code = r.res.statusCode;
    const loc = r.res.headers.location;
    if (loc && [301, 302, 303, 307, 308].includes(code) && n < MAX_REDIRECTS) {
      redirects.push({ status: code, url });
      url = new URL(loc, url).toString();
      if (code === 303 || ((code === 301 || code === 302) && method === 'POST')) {
        method = 'GET';
        bodyBuf = null;
        delete hdrs['content-length'];
        delete hdrs['content-type'];
      }
      continue;
    }
    const raw = r.res.rawHeaders;
    const outHeaders = [];
    const setCookie = [];
    for (let i = 0; i < raw.length; i += 2) {
      if (raw[i].toLowerCase() === 'set-cookie') setCookie.push(raw[i + 1]);
      outHeaders.push([raw[i], raw[i + 1]]);
    }
    const { body: decodedBody, decoded } = decompress(r.body, r.res.headers['content-encoding']);
    const finalHeaders = decoded ? outHeaders.filter(([k]) => !['content-encoding', 'content-length'].includes(k.toLowerCase())) : outHeaders;
    if (decoded) finalHeaders.push(['x-apiclient-decoded-encoding', String(r.res.headers['content-encoding'])]);
    return {
      status: code,
      statusText: r.res.statusMessage || '',
      headers: finalHeaders,
      setCookie,
      body: decodedBody.toString('base64'),
      truncated: r.truncated,
      timings: total,
      redirects,
      finalUrl: url,
    };
  }
}

export function createServer(opts) {
  const patterns = opts.allow.split(',');
  const log = opts.quiet ? () => {} : (...a) => console.log(new Date().toISOString(), ...a);
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = originAllowed(origin, patterns);
    const send = (code, obj) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        ...(allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'origin' } : {}),
      });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') {
      if (!allowed) return send(403, { error: `Origin ${origin || '(none)'} is not allowed. Start the proxy with --allow ${origin || 'http://your-origin'}` });
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'origin',
        // Chrome's Private Network Access preflight: a public https page may reach localhost only if we opt in.
        ...(req.headers['access-control-request-private-network'] === 'true' ? { 'access-control-allow-private-network': 'true' } : {}),
      });
      return res.end();
    }
    if (!allowed) return send(403, { error: `Origin ${origin || '(none)'} is not allowed. Start the proxy with --allow ${origin || 'http://your-origin'}` });
    const path = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && path === '/ping') return send(200, { ok: true, name: 'apiclient-proxy', version: VERSION, pid: process.pid });
    if (req.method === 'POST' && path === '/shutdown') {
      log('shutdown requested by', origin);
      send(200, { ok: true });
      // Let the response flush before closing.
      setImmediate(() => (opts.onShutdown ?? (() => server.close()))());
      return;
    }
    if (req.method === 'POST' && path === '/send') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8'));
      } catch (e) {
        return send(400, { error: `Bad request: ${e.message}` });
      }
      if (!payload || typeof payload.url !== 'string') return send(400, { error: 'Missing url' });
      const started = performance.now();
      try {
        const out = await forward(payload);
        log(`${String(payload.method || 'GET').toUpperCase()} ${payload.url} → ${out.status} in ${round(performance.now() - started)} ms`);
        return send(200, out);
      } catch (e) {
        log(`${String(payload.method || 'GET').toUpperCase()} ${payload.url} → error: ${e.message}`);
        return send(502, { error: e.message, status: 0, timings: { total: round(performance.now() - started) } });
      }
    }
    send(404, { error: 'Not found. Endpoints: GET /ping, POST /send, POST /shutdown' });
  });
  return server;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Called when the port is taken. If the taker is an API Client proxy (an older run of this
 * script), ask it to shut down — or end it by pid if it predates /shutdown — and wait for the
 * port to free up. Anything else on the port is left alone.
 * Returns 'freed', 'foreign' (another program), or 'stuck' (our proxy but it wouldn't stop).
 */
export async function takeOverPort(port, host) {
  const base = `http://${host}:${port}`;
  const headers = { origin: 'http://localhost' };
  let info = null;
  try {
    const res = await fetch(`${base}/ping`, { headers, signal: AbortSignal.timeout(2000) });
    info = await res.json().catch(() => null);
    // A proxy started with a custom --allow list that excludes localhost answers 403 with this message.
    if (res.status === 403 && /Start the proxy with --allow/.test(info?.error ?? '')) return 'stuck';
  } catch {
    return 'foreign';
  }
  if (info?.name !== 'apiclient-proxy') return 'foreign';
  console.log(`An API Client proxy (v${info.version}${info.pid ? `, pid ${info.pid}` : ''}) is already running on port ${port}; stopping it…`);
  const res = await fetch(`${base}/shutdown`, { method: 'POST', headers, signal: AbortSignal.timeout(2000) }).catch(() => null);
  if (!res?.ok && info.pid) {
    try {
      process.kill(info.pid, 'SIGTERM');
    } catch {
      /* already gone, or not ours to signal */
    }
  }
  for (let i = 0; i < 50; i++) {
    const free = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, host, () => probe.close(() => resolve(true)));
    });
    if (free) return 'freed';
    await sleep(100);
  }
  return 'stuck';
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const server = createServer({
    ...opts,
    onShutdown: () => {
      console.log('Stopped from the app (or by a newer proxy taking over the port).');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref(); // don't wait on keep-alive connections
    },
  });
  const fail = (msg) => {
    console.error(msg);
    process.exit(1);
  };
  try {
    await listen(server, opts.port, opts.host);
  } catch (e) {
    if (e.code !== 'EADDRINUSE') fail(e.message);
    const outcome = await takeOverPort(opts.port, opts.host);
    if (outcome === 'foreign') fail(`Port ${opts.port} is used by another program (not the API Client proxy). Pick another port, e.g. --port ${opts.port + 1}, and set the same port in the app.`);
    if (outcome === 'stuck') fail(`An API Client proxy on port ${opts.port} didn't stop. Stop it with Ctrl+C in its terminal, or use another port.`);
    try {
      await listen(server, opts.port, opts.host);
    } catch (e2) {
      fail(e2.code === 'EADDRINUSE' ? `Port ${opts.port} was taken again before this proxy could start. Run the command again.` : e2.message);
    }
  }
  server.on('error', (e) => console.error(e.message));
  console.log(`API Client proxy v${VERSION} listening on http://${opts.host}:${opts.port}`);
  console.log(`Allowed origins: ${opts.allow}`);
  console.log('Keep this window open. Stop with Ctrl+C or the Stop button in the app. Running the command again restarts it.');
}
