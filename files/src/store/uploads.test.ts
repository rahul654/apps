// @vitest-environment jsdom
/**
 * The upload queue against the real Apps Script code: fetch is routed in-process to
 * apps-script/Code.gs running on the fake Drive (apps-script/runtime.mjs).
 */
import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS test helper
import { loadFilesScript } from '../../apps-script/runtime.mjs';

vi.mock('../lib/env', () => ({ SCRIPT_URL: 'http://mock/exec', MEDIA_BASE: '' }));
// Retry quickly in tests.
vi.mock('../lib/upload', async (orig) => ({ ...(await orig<typeof import('../lib/upload')>()), retryDelay: (n: number) => (n <= 4 ? 5 : null) }));

const PASSWORD = 'pw';
const MIB = 1024 * 1024;

type Script = ReturnType<typeof loadFilesScript>;
let gs: Script;
let actions: { action: string; name?: string; offset?: number }[];
let mods: typeof import('./uploads') & { auth: typeof import('./auth'); library: typeof import('./library') };

function fileOf(name: string, size: number, type = 'application/octet-stream', seed = 1) {
  const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 13 + seed) & 0xff));
  return { file: new NodeFile([bytes], name, { type }) as unknown as File, bytes };
}

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const driveFile = (name: string) => [...gs.drive.files.values()].find((f: { name: string }) => f.name === name);

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  gs = loadFilesScript({ password: PASSWORD });
  actions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      actions.push({ action: body.action, name: body.name, offset: body.offset });
      await new Promise((r) => setTimeout(r, 1));
      return new Response(JSON.stringify(gs.post(body)), { status: 200 });
    }),
  );
  const uploads = await import('./uploads');
  mods = { ...uploads, auth: await import('./auth'), library: await import('./library') };
  await mods.auth.login(PASSWORD);
  await mods.library.refresh();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upload queue', () => {
  it('uploads several files smallest first, in chunks, byte for byte', async () => {
    const big = fileOf('big.mp4', 9 * MIB + 5, 'video/mp4', 3); // 2 chunks: 8 MiB + rest
    const small = fileOf('small.txt', 10, 'text/plain', 4);
    const mid = fileOf('mid.jpg', 300 * 1024, 'image/jpeg', 5);
    mods.addFiles([big.file, small.file, mid.file]);
    await until(() => mods.uploads.get().jobs.every((j) => j.state === 'done'));

    expect(actions.filter((a) => a.action === 'start').map((a) => a.name)).toEqual(['small.txt', 'mid.jpg', 'big.mp4']);
    expect(actions.filter((a) => a.action === 'chunk').map((a) => a.offset)).toEqual([0, 0, 0, 8 * MIB]);
    for (const { bytes, file } of [big, small, mid]) expect(driveFile(file.name).content.equals(bytes)).toBe(true);
    // The list shows them without waiting for a refresh, with the space used.
    expect(mods.library.library.get().items.map((i) => i.name)).toEqual(['big.mp4', 'mid.jpg', 'small.txt']);
    expect(mods.library.library.get().used).toBe(9 * MIB + 5 + 10 + 300 * 1024);
  });

  it('files added while uploading join the queue in size order', async () => {
    const a = fileOf('a.bin', 600 * 1024);
    mods.addFiles([a.file]);
    await until(() => actions.some((x) => x.action === 'chunk'));
    mods.addFiles([fileOf('c.bin', 300).file, fileOf('b.bin', 200).file]);
    await until(() => mods.uploads.get().jobs.every((j) => j.state === 'done'));
    expect(actions.filter((x) => x.action === 'start').map((x) => x.name)).toEqual(['a.bin', 'b.bin', 'c.bin']);
  });

  it('retries a failed chunk after checking where Drive is', async () => {
    gs.drive.failNext(503, (method: string) => method === 'put', 2);
    const f = fileOf('x.bin', 600 * 1024);
    mods.addFiles([f.file]);
    await until(() => mods.uploads.get().jobs[0].state === 'done');
    expect(driveFile('x.bin').content.equals(f.bytes)).toBe(true);
    expect(actions.map((a) => a.action)).toContain('status');
  });

  it('pauses after 4 failed retries, and Retry continues', async () => {
    gs.drive.failNext(503, (method: string) => method === 'put', 5);
    const f = fileOf('x.bin', 600 * 1024);
    mods.addFiles([f.file]);
    await until(() => mods.uploads.get().pause === 'error');
    expect(mods.uploads.get().jobs[0].state).toBe('paused');
    mods.resume();
    await until(() => mods.uploads.get().jobs[0].state === 'done');
    expect(driveFile('x.bin').content.equals(f.bytes)).toBe(true);
  });

  it('a password change mid-upload pauses it and asks; logging in continues from the same spot', async () => {
    const f = fileOf('long.bin', 9 * MIB);
    // Change the password right after the first chunk lands.
    const realFetch = globalThis.fetch as unknown as (u: string, i: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', async (u: string, init: RequestInit) => {
      const res = await realFetch(u, init);
      if (JSON.parse(String(init.body)).action === 'chunk') gs.props.set('UPLOAD_PASSWORD', 'new-pw');
      return res;
    });
    mods.addFiles([f.file]);
    await until(() => mods.uploads.get().pause === 'login');
    expect(mods.auth.auth.get().session).toBeNull();
    expect(mods.auth.auth.get().prompt?.message).toMatch(/password was changed/);
    expect(mods.uploads.get().jobs[0]).toMatchObject({ state: 'paused', received: 8 * MIB });

    await expect(mods.auth.login('pw')).rejects.toMatchObject({ code: 'wrong' });
    await mods.auth.login('new-pw'); // resumes by itself
    await until(() => mods.uploads.get().jobs[0].state === 'done');
    expect(driveFile('long.bin').content.equals(f.bytes)).toBe(true);
    expect(actions.filter((a) => a.action === 'start')).toHaveLength(1); // not started over
  });

  it('a login that ran out locally pauses before sending', async () => {
    const s = mods.auth.auth.get().session!;
    mods.auth.auth.set((st) => ({ ...st, session: { ...s, exp: Date.now() - 1 } }));
    mods.addFiles([fileOf('x.bin', 10).file]);
    await until(() => mods.uploads.get().pause === 'login');
    expect(actions.some((a) => a.action === 'start')).toBe(false);
  });

  it('skips files that don’t fit, and keeps going with the rest', async () => {
    gs.props.set('LIMIT_MB', '1');
    await mods.library.refresh();
    mods.addFiles([fileOf('huge.bin', 2 * MIB).file, fileOf('ok.bin', 1000).file]);
    await until(() => mods.uploads.get().jobs.every((j) => j.state === 'done' || j.state === 'skipped'));
    const jobs = mods.uploads.get().jobs;
    expect(jobs.find((j) => j.name === 'huge.bin')).toMatchObject({ state: 'skipped', error: expect.stringMatching(/Not enough space/) });
    expect(jobs.find((j) => j.name === 'ok.bin')?.state).toBe('done');
    // The page knew it wouldn't fit: the script was never asked.
    expect(actions.filter((a) => a.action === 'start').map((a) => a.name)).toEqual(['ok.bin']);
  });

  it('the script’s own limit check is respected too (space taken elsewhere)', async () => {
    gs.props.set('LIMIT_MB', '1');
    await mods.library.refresh();
    gs.post({ action: 'start', token: mods.auth.auth.get().session!.token, name: 'other-device.bin', size: MIB - 100 }); // reserved elsewhere
    mods.addFiles([fileOf('x.bin', 1000).file]);
    await until(() => mods.uploads.get().jobs[0].state === 'skipped');
    expect(mods.uploads.get().jobs[0].error).toMatch(/Not enough space: needs 1000 B, 100 B left/);
  });

  it('cancel stops an upload and frees its space on Google’s side', async () => {
    mods.addFiles([fileOf('a.bin', 9 * MIB).file, fileOf('b.bin', 9 * MIB + 1).file]);
    await until(() => actions.some((a) => a.action === 'chunk'));
    const first = mods.uploads.get().jobs.find((j) => j.name === 'a.bin')!;
    mods.cancelJob(first.id);
    await until(() => mods.uploads.get().jobs.length === 1 && mods.uploads.get().jobs[0].state === 'done');
    await until(() => actions.some((a) => a.action === 'cancel'));
    expect(driveFile('a.bin')).toBeUndefined();
    expect([...gs.props.keys()].filter((k: string) => k.startsWith('upload:'))).toEqual([]);
  });

  it('an empty file and failed/retried files', async () => {
    mods.addFiles([fileOf('empty.txt', 0, 'text/plain').file]);
    await until(() => mods.uploads.get().jobs[0].state === 'done');
    expect(driveFile('empty.txt').content.length).toBe(0);
    mods.clearFinished();
    expect(mods.uploads.get().jobs).toEqual([]);
  });
});

describe('text and delete', () => {
  it('adds text, reads it back and deletes items permanently', async () => {
    const item = await mods.library.addText('hello there\nsecond line');
    expect(mods.library.library.get().items[0]).toMatchObject({ id: item.id, kind: 'text', name: 'hello there.txt' });
    await expect(mods.library.loadText(item.id)).resolves.toBe('hello there\nsecond line');
    await expect(mods.library.deleteItems([item.id, 'already-gone'])).resolves.toEqual({ deleted: 2, refused: 0 });
    expect(mods.library.library.get().items).toEqual([]);
    expect(gs.drive.files.has(item.id)).toBe(false);
  });

  it('writes without a login open the password dialog', async () => {
    mods.auth.logout();
    await expect(mods.library.addText('x')).rejects.toMatchObject({ code: 'invalid' });
    expect(mods.auth.auth.get().prompt?.message).toMatch(/upload password first/);
  });

  it('a refused token ends the login and asks again', async () => {
    gs.props.set('UPLOAD_PASSWORD', 'changed');
    await expect(mods.library.deleteItems(['x'])).rejects.toMatchObject({ code: 'changed' });
    expect(mods.auth.auth.get().session).toBeNull();
    expect(mods.auth.auth.get().prompt?.message).toMatch(/changed/);
  });
});

describe('login checks', () => {
  it('verify ends a login the script no longer accepts; offline keeps it', async () => {
    await mods.auth.verify();
    expect(mods.auth.auth.get().session).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await mods.auth.verify();
    expect(mods.auth.auth.get().session).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'expired' }))));
    await mods.auth.verify();
    expect(mods.auth.auth.get().session).toBeNull();
    expect(localStorage.getItem('files:session:v1')).toBeNull();
  });

  it('recheck follows other tabs and local expiry', () => {
    const s = mods.auth.auth.get().session!;
    localStorage.removeItem('files:session:v1'); // signed out in another tab
    mods.auth.recheck();
    expect(mods.auth.auth.get().session).toBeNull();
    localStorage.setItem('files:session:v1', JSON.stringify(s)); // signed in again elsewhere
    mods.auth.recheck();
    expect(mods.auth.auth.get().session?.token).toBe(s.token);
    localStorage.setItem('files:session:v1', JSON.stringify({ ...s, exp: Date.now() - 1 }));
    mods.auth.recheck();
    expect(mods.auth.auth.get().session).toBeNull();
  });
});
