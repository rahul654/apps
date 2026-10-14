/**
 * Sends a prepared request either straight from the browser (`fetch`) or via the local proxy.
 * Returns a record with status, headers, body text, size and timing.
 */
import type { PreparedRequest, KV } from './build';

export interface Timings {
  dns?: number;
  connect?: number;
  tls?: number;
  ttfb?: number;
  download?: number;
  total: number;
  /** Where the numbers came from. */
  source: 'proxy' | 'resource-timing' | 'wall-clock';
}

export interface ResponseRecord {
  ok: boolean;
  status: number;
  statusText: string;
  headers: KV[];
  /** Set-Cookie values; only available through the proxy. */
  setCookie?: string[];
  bodyText: string;
  /** True when the body was not decodable as text (shown as a hex/size summary). */
  binary: boolean;
  /** Body size in bytes. */
  size: number;
  /** Total time in ms. */
  time: number;
  timings: Timings;
  contentType: string;
  /** Set when the request could not be sent/completed. */
  error?: { kind: 'cors' | 'network' | 'abort' | 'proxy' | 'invalid'; message: string };
  via: 'direct' | 'proxy';
  /** Body truncated for storage. */
  truncated?: boolean;
}

export interface SendOptions {
  mode: 'direct' | 'proxy';
  proxyUrl: string;
  signal?: AbortSignal;
  /** Keep at most this many body bytes (history storage); default 2 MiB. */
  maxBody?: number;
}

const MAX_BODY = 2 * 1024 * 1024;

function decodeBody(bytes: Uint8Array, contentType: string): { text: string; binary: boolean } {
  const textual = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|ld\+json|problem\+json)|.*\+(json|xml))/i.test(contentType) || contentType === '';
  try {
    const text = new TextDecoder('utf-8', { fatal: !textual }).decode(bytes);
    if (!textual && /[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 4096))) return { text: '', binary: true };
    return { text, binary: false };
  } catch {
    return { text: '', binary: true };
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bodyInit(req: PreparedRequest): Promise<{ body: BodyInit | null; contentType?: string }> {
  const b = req.body;
  if (b.kind === 'text') return { body: b.text };
  if (b.kind === 'bytes') return { body: b.bytes as Uint8Array<ArrayBuffer> };
  if (b.kind === 'form') {
    const fd = new FormData();
    for (const p of b.parts) {
      if (p.file) fd.append(p.key, p.file, p.fileName);
      else fd.append(p.key, p.value ?? '');
    }
    return { body: fd };
  }
  return { body: null };
}

/** Serialises any body to bytes + content type, so the proxy receives exactly what the browser would send. */
export async function bodyToBytes(req: PreparedRequest): Promise<{ bytes: Uint8Array | null; contentType: string | null }> {
  const b = req.body;
  if (b.kind === 'none') return { bytes: null, contentType: null };
  if (b.kind === 'text') return { bytes: new TextEncoder().encode(b.text), contentType: b.contentType };
  if (b.kind === 'bytes') return { bytes: b.bytes, contentType: b.contentType };
  const { body } = await bodyInit(req);
  const r = new Response(body);
  return { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
}

function classifyFetchError(e: unknown, signal?: AbortSignal): ResponseRecord['error'] {
  if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return { kind: 'abort', message: 'Request cancelled.' };
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid url|failed to parse url|url/i.test(msg) && e instanceof TypeError && /url/i.test(msg)) return { kind: 'invalid', message: msg };
  // Browsers hide the reason: a TypeError "Failed to fetch" / "NetworkError" is either CORS or the network.
  return { kind: 'cors', message: msg };
}

export async function sendRequest(req: PreparedRequest, opts: SendOptions): Promise<ResponseRecord> {
  const maxBody = opts.maxBody ?? MAX_BODY;
  if (opts.mode === 'proxy') return sendViaProxy(req, opts, maxBody);
  const start = performance.now();
  const base = (status: number): ResponseRecord => ({ ok: false, status, statusText: '', headers: [], bodyText: '', binary: false, size: 0, time: 0, timings: { total: 0, source: 'wall-clock' }, contentType: '', via: 'direct' });
  const canHaveBody = !['GET', 'HEAD'].includes(req.method);
  let init: RequestInit;
  try {
    const { body } = await bodyInit(req);
    const headers = new Headers();
    for (const h of req.headers) {
      // FormData sets its own multipart boundary; a hand-set Content-Type would break it.
      if (req.body.kind === 'form' && h.key.toLowerCase() === 'content-type') continue;
      try {
        headers.append(h.key, h.value);
      } catch {
        /* forbidden/invalid header name: skipped, the UI warns about these */
      }
    }
    init = { method: req.method, headers, body: canHaveBody ? body : null, signal: opts.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store' };
  } catch (e) {
    return { ...base(0), error: { kind: 'invalid', message: e instanceof Error ? e.message : String(e) } };
  }
  let res: Response;
  try {
    res = await fetch(req.url, init);
  } catch (e) {
    const time = performance.now() - start;
    return { ...base(0), time, timings: { total: time, source: 'wall-clock' }, error: classifyFetchError(e, opts.signal) };
  }
  const ttfb = performance.now() - start;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    const time = performance.now() - start;
    return { ...base(res.status), statusText: res.statusText, time, timings: { total: time, source: 'wall-clock' }, error: { kind: 'network', message: `Body could not be read: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const total = performance.now() - start;
  const headers: KV[] = [];
  res.headers.forEach((value, key) => headers.push({ key, value }));
  const contentType = res.headers.get('content-type') ?? '';
  const truncated = bytes.length > maxBody;
  const { text, binary } = decodeBody(truncated ? bytes.subarray(0, maxBody) : bytes, contentType);
  const timings = resourceTimings(req.url, start, ttfb, total);
  return { ok: res.ok, status: res.status, statusText: res.statusText, headers, bodyText: text, binary, size: bytes.length, time: total, timings, contentType, via: 'direct', truncated };
}

/** Uses PerformanceResourceTiming when the server sends Timing-Allow-Origin; otherwise only TTFB/download are known. */
function resourceTimings(url: string, _start: number, ttfb: number, total: number): Timings {
  try {
    const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
    const e = entries[entries.length - 1];
    if (e && e.domainLookupStart > 0 && e.responseStart > 0) {
      const dns = e.domainLookupEnd - e.domainLookupStart;
      const connect = e.connectEnd - e.connectStart;
      const tls = e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : 0;
      const wait = e.responseStart - e.requestStart;
      const download = e.responseEnd - e.responseStart;
      return { dns, connect: connect - tls, tls, ttfb: wait, download, total, source: 'resource-timing' };
    }
  } catch {
    /* not available */
  }
  return { ttfb, download: total - ttfb, total, source: 'wall-clock' };
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  setCookie: string[];
  body: string;
  timings: { dns: number; connect: number; tls: number; ttfb: number; download: number; total: number };
  error?: string;
}

async function sendViaProxy(req: PreparedRequest, opts: SendOptions, maxBody: number): Promise<ResponseRecord> {
  const start = performance.now();
  const base = (): ResponseRecord => ({ ok: false, status: 0, statusText: '', headers: [], bodyText: '', binary: false, size: 0, time: 0, timings: { total: 0, source: 'wall-clock' }, contentType: '', via: 'proxy' });
  let payload: { method: string; url: string; headers: [string, string][]; body?: string };
  try {
    const { bytes, contentType } = await bodyToBytes(req);
    const headers: [string, string][] = req.headers.filter((h) => !(req.body.kind === 'form' && h.key.toLowerCase() === 'content-type')).map((h) => [h.key, h.value]);
    if (contentType && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', contentType]);
    payload = { method: req.method, url: req.url, headers, ...(bytes && !['GET', 'HEAD'].includes(req.method) ? { body: bytesToBase64(bytes) } : {}) };
  } catch (e) {
    return { ...base(), error: { kind: 'invalid', message: e instanceof Error ? e.message : String(e) } };
  }
  let res: Response;
  try {
    res = await fetch(`${opts.proxyUrl.replace(/\/$/, '')}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: opts.signal });
  } catch (e) {
    const time = performance.now() - start;
    if (opts.signal?.aborted) return { ...base(), time, error: { kind: 'abort', message: 'Request cancelled.' } };
    return { ...base(), time, error: { kind: 'proxy', message: `Could not reach the proxy at ${opts.proxyUrl}: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const time = performance.now() - start;
  let data: ProxyResponse;
  try {
    data = (await res.json()) as ProxyResponse;
  } catch {
    return { ...base(), time, error: { kind: 'proxy', message: `Proxy returned an unreadable reply (HTTP ${res.status}).` } };
  }
  if (!res.ok || data.error) return { ...base(), time, timings: { ...(data.timings ?? { total: time }), source: 'proxy' }, error: { kind: data.status ? 'network' : 'proxy', message: data.error ?? `Proxy error (HTTP ${res.status})` } };
  const bytes = base64ToBytes(data.body ?? '');
  const headers: KV[] = (data.headers ?? []).map(([key, value]) => ({ key, value }));
  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  const truncated = bytes.length > maxBody;
  const { text, binary } = decodeBody(truncated ? bytes.subarray(0, maxBody) : bytes, contentType);
  return {
    ok: data.status >= 200 && data.status < 300,
    status: data.status,
    statusText: data.statusText ?? '',
    headers,
    setCookie: data.setCookie ?? [],
    bodyText: text,
    binary,
    size: bytes.length,
    time: data.timings?.total ?? time,
    timings: { ...data.timings, source: 'proxy' },
    contentType,
    via: 'proxy',
    truncated,
  };
}

export interface ProxyStatus {
  ok: boolean;
  version?: string;
  message?: string;
}

export async function pingProxy(proxyUrl: string, signal?: AbortSignal): Promise<ProxyStatus> {
  try {
    const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/ping`, { signal, cache: 'no-store' });
    const j = (await res.json()) as { ok?: boolean; name?: string; version?: string };
    if (j.ok && j.name === 'apiclient-proxy') return { ok: true, version: j.version };
    return { ok: false, message: 'Something answered, but it is not the API Client proxy.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
