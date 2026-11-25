import { describe, expect, it, vi } from 'vitest';
import { ApiError, callScript } from './api';
import { formatBytes, formatDuration, formatMinutes, formatWhen } from './format';
import { categoryOf, matchesFilter, mediaUrls, parseItem, parseLibrary, type Item } from './items';
import { readSession, SESSION_MS, sessionFrom } from './session';
import { bySizeAscending, bytesToBase64, chunkAt, chunkSizeFrom, CHUNK_UNIT, fits, MAX_CHUNK, retryDelay } from './upload';

const NOW = 1_700_000_000_000;

describe('session', () => {
  it('builds from a login reply, capped at 12 hours', () => {
    expect(sessionFrom('t', 1000, NOW)).toEqual({ v: 1, token: 't', exp: NOW + 1000 });
    expect(sessionFrom('t', SESSION_MS * 5, NOW)?.exp).toBe(NOW + SESSION_MS);
    for (const [token, ttl] of [['', 1000], ['t', 0], ['t', -5], ['t', NaN], [5, 1000], ['t', '1000']] as const) expect(sessionFrom(token, ttl, NOW)).toBeNull();
  });

  it('reads only valid, unexpired, not-too-long sessions', () => {
    const ok = JSON.stringify({ v: 1, token: 't', exp: NOW + 1000 });
    expect(readSession(ok, NOW)).toEqual({ v: 1, token: 't', exp: NOW + 1000 });
    expect(readSession(ok, NOW + 1000)).toBeNull();
    expect(readSession(JSON.stringify({ v: 1, token: 't', exp: NOW + SESSION_MS + 1 }), NOW)).toBeNull();
    for (const raw of [null, '', 'x', '[]', 'null', JSON.stringify({ v: 2, token: 't', exp: NOW + 1 }), JSON.stringify({ v: 1, token: '', exp: NOW + 1 }), JSON.stringify({ v: 1, token: 't', exp: 'soon' })])
      expect(readSession(raw, NOW)).toBeNull();
  });
});

describe('items', () => {
  const raw = { id: 'abc_1-2', name: 'a.jpg', mimeType: 'image/jpeg', size: 10, created: '2026-11-22T10:00:00Z', kind: 'file' };

  it('parses and validates items', () => {
    expect(parseItem(raw)).toEqual(raw);
    expect(parseItem({ ...raw, kind: 'text', preview: 'hi' })).toMatchObject({ kind: 'text', preview: 'hi' });
    expect(parseItem({ ...raw, kind: 'text' })?.preview).toBe('');
    expect(parseItem({ ...raw, size: '12' })?.size).toBe(12);
    expect(parseItem({ ...raw, size: -1 })?.size).toBe(0);
    expect(parseItem({ ...raw, kind: 'weird' })?.kind).toBe('file');
    for (const bad of [null, 'x', { ...raw, id: '../x' }, { ...raw, id: '' }, { ...raw, name: 5 }]) expect(parseItem(bad)).toBeNull();
  });

  it('parses a list reply, dropping bad items', () => {
    expect(parseLibrary({ ok: true, items: [raw, { id: '!' }], used: 10, limit: 100 })).toEqual({ items: [raw], used: 10, limit: 100 });
    expect(parseLibrary(null)).toEqual({ items: [], used: 0, limit: 0 });
    expect(parseLibrary({ items: 'x', used: -1, limit: 'big' })).toEqual({ items: [], used: 0, limit: 0 });
  });

  it('sorts items into categories and filters', () => {
    const item = (mimeType: string, kind: Item['kind'] = 'file') => ({ ...raw, mimeType, kind }) as Item;
    expect(categoryOf(item('image/heic'))).toBe('image');
    expect(categoryOf(item('video/quicktime'))).toBe('video');
    expect(categoryOf(item('audio/mpeg'))).toBe('audio');
    expect(categoryOf(item('application/pdf'))).toBe('pdf');
    expect(categoryOf(item('application/zip'))).toBe('other');
    expect(categoryOf(item('text/plain', 'text'))).toBe('text');
    expect(categoryOf(item('text/plain'))).toBe('other'); // an uploaded .txt file is a file
    expect(matchesFilter(item('video/mp4'), 'media')).toBe(true);
    expect(matchesFilter(item('text/plain', 'text'), 'media')).toBe(false);
    expect(matchesFilter(item('application/pdf'), 'other')).toBe(true);
    expect(matchesFilter(item('text/plain', 'text'), 'text')).toBe(true);
    expect(matchesFilter(item('image/png'), 'all')).toBe(true);
  });

  it('builds Drive URLs, or mock ones', () => {
    const img = mediaUrls({ id: 'F1', kind: 'file', mimeType: 'image/png', name: 'a.png' });
    expect(img).toEqual({
      thumb: 'https://drive.google.com/thumbnail?id=F1&sz=w480',
      full: 'https://drive.google.com/thumbnail?id=F1&sz=w2000',
      preview: 'https://drive.google.com/file/d/F1/preview',
      download: 'https://drive.google.com/uc?export=download&id=F1',
      open: 'https://drive.google.com/file/d/F1/view',
    });
    const zip = mediaUrls({ id: 'F2', kind: 'file', mimeType: 'application/zip', name: 'a.zip' });
    expect(zip.thumb).toBeUndefined();
    expect(zip.full).toBeUndefined();
    expect(mediaUrls({ id: 'F3', kind: 'file', mimeType: 'video/mp4', name: 'v.mp4' }, 'http://localhost:4336/')).toMatchObject({
      thumb: 'http://localhost:4336/thumb/F3',
      preview: 'http://localhost:4336/preview/F3',
      download: 'http://localhost:4336/media/F3?download',
    });
  });
});

describe('upload helpers', () => {
  it('uses the script’s chunk size only when Drive will accept it', () => {
    expect(chunkSizeFrom(4 * CHUNK_UNIT)).toBe(4 * CHUNK_UNIT);
    for (const bad of [undefined, 0, 1000, CHUNK_UNIT * 1.5, MAX_CHUNK + CHUNK_UNIT, 'x']) expect(chunkSizeFrom(bad)).toBe(MAX_CHUNK);
  });

  it('cuts chunks at the file end', () => {
    expect(chunkAt(0, 100, 30)).toEqual({ start: 0, end: 30 });
    expect(chunkAt(90, 100, 30)).toEqual({ start: 90, end: 100 });
  });

  it('orders smallest first, keeping the added order for equal sizes', () => {
    const jobs = [
      { id: 'a', size: 50, seq: 1 },
      { id: 'b', size: 5, seq: 2 },
      { id: 'c', size: 50, seq: 3 },
      { id: 'd', size: 0, seq: 4 },
    ];
    expect(bySizeAscending(jobs).map((j) => j.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(jobs.map((j) => j.id)).toEqual(['a', 'b', 'c', 'd']); // not mutated
  });

  it('checks space (no limit known = fits)', () => {
    expect(fits(10, 90, 100)).toBe(true);
    expect(fits(11, 90, 100)).toBe(false);
    expect(fits(10, 0, 0)).toBe(true);
  });

  it('retries 4 times, then gives up', () => {
    expect([1, 2, 3, 4, 5].map(retryDelay)).toEqual([2000, 5000, 10000, 20000, null]);
  });

  it('base64-encodes like Buffer, for any size', () => {
    for (const n of [0, 1, 2, 3, 0x8000 + 7, 300_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('format', () => {
  it('bytes', () => {
    expect([0, 999, 1024, 1536, 10 * 1024 * 1024, 123.4 * 1024 * 1024, 1024 ** 3].map(formatBytes)).toEqual(['0 B', '999 B', '1 KB', '1.5 KB', '10 MB', '123 MB', '1 GB']);
    expect(formatBytes(-1)).toBe('–');
  });

  it('relative times', () => {
    const now = Date.parse('2026-11-22T15:00:00');
    expect(formatWhen(new Date(now - 10_000).toISOString(), now)).toBe('just now');
    expect(formatWhen(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(formatWhen(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('3 h ago');
    expect(formatWhen(new Date(Date.parse('2026-11-21T20:00:00')).toISOString(), now)).toBe('yesterday');
    expect(formatWhen('nope', now)).toBe('');
  });

  it('minutes left and durations', () => {
    expect(formatMinutes(3_000_000)).toBe('50 min');
    expect(formatMinutes(1)).toBe('1 min');
    expect(formatMinutes(-5)).toBe('0 min');
    expect(formatMinutes(3_600_000)).toBe('1 h');
    expect(formatMinutes(4_320_000)).toBe('1 h 12 min');
    expect(formatMinutes(43_200_000)).toBe('12 h');
    expect([5, 90, 120, 3720].map(formatDuration)).toEqual(['5 s', '1 min 30 s', '2 min', '1 h 2 min']);
  });
});

describe('callScript', () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('POSTs JSON as text/plain and returns ok replies', async () => {
    const fetchImpl = ok({ ok: true, x: 1 });
    await expect(callScript({ action: 'list' }, { url: 'http://s/exec', fetchImpl })).resolves.toEqual({ ok: true, x: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://s/exec');
    expect(init).toMatchObject({ method: 'POST', body: '{"action":"list"}', credentials: 'omit', redirect: 'follow' });
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/);
  });

  it('turns script errors, bad replies and network failures into ApiErrors', async () => {
    const err = (p: Promise<unknown>) => p.then(() => null, (e: ApiError) => [e.code, e.isAuth, e.isTransient]);
    expect(await err(callScript({}, { url: 'u', fetchImpl: ok({ ok: false, error: 'expired' }) }))).toEqual(['expired', true, false]);
    expect(await err(callScript({}, { url: 'u', fetchImpl: ok({ ok: false, error: 'something-new' }) }))).toEqual(['server', false, true]);
    expect(await err(callScript({}, { url: 'u', fetchImpl: ok({ nope: 1 }) }))).toEqual(['network', false, true]);
    expect(await err(callScript({}, { url: 'u', fetchImpl: vi.fn(async () => new Response('x', { status: 500 })) }))).toEqual(['network', false, true]);
    expect(await err(callScript({}, { url: 'u', fetchImpl: vi.fn(async () => Promise.reject(new TypeError('offline'))) }))).toEqual(['network', false, true]);
    expect(await err(callScript({}, { url: '' }))).toEqual(['no-url', false, false]);
    const reply = await callScript({}, { url: 'u', fetchImpl: ok({ ok: false, error: 'full', used: 5, limit: 6 }) }).catch((e: ApiError) => e.reply);
    expect(reply).toMatchObject({ used: 5, limit: 6 });
  });

  it('times out, and lets the caller cancel', async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(callScript({}, { url: 'u', fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    const ctrl = new AbortController();
    const p = callScript({}, { url: 'u', fetchImpl: hang as unknown as typeof fetch, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
