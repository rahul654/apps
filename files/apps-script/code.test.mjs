// Tests for Code.gs, run in Node through runtime.mjs (fake Apps Script services + fake Drive).
import { describe, expect, it } from 'vitest';
import { FakeDrive, loadFilesScript } from './runtime.mjs';

const HOUR = 3_600_000;
const SESSION = 12 * HOUR;
const KIB = 1024;
const MIB = 1024 * KIB;
const PASSWORD = 'upload-pass';

function setup(options = {}) {
  const gs = loadFilesScript({ password: PASSWORD, ...options });
  const { token } = gs.post({ action: 'login', password: PASSWORD });
  const call = (body) => gs.post({ token, ...body });
  return { gs, token, call };
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const bytes = (n, seed = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff));

/** Uploads a buffer in chunks the way the page does. */
function upload(call, name, buf, { type = 'application/octet-stream', chunk = 256 * KIB } = {}) {
  const start = call({ action: 'start', name, size: buf.length, type });
  if (!start.ok || start.done) return start;
  let offset = 0;
  let reply;
  while (offset < buf.length) {
    reply = call({ action: 'chunk', uploadId: start.uploadId, offset, data: b64(buf.subarray(offset, offset + chunk)) });
    if (!reply.ok) return reply;
    if (reply.done) return reply;
    offset = reply.received;
  }
  return reply;
}

describe('setup and GET', () => {
  it('GET says whether UPLOAD_PASSWORD is set', () => {
    expect(loadFilesScript({ password: PASSWORD }).get()).toEqual({ ok: true, service: 'files', configured: true });
    expect(loadFilesScript().get().configured).toBe(false);
  });

  it('setup() makes one shared folder and remembers it', () => {
    const gs = loadFilesScript({ password: PASSWORD });
    gs.run('setup');
    const id = gs.props.get('FOLDER_ID');
    expect(id).toBeTruthy();
    expect(gs.drive.files.get(id).sharing).toBe('ANYONE_WITH_LINK:VIEW');
    gs.run('setup');
    expect(gs.props.get('FOLDER_ID')).toBe(id);
    expect([...gs.drive.files.values()].filter((f) => f.mimeType.endsWith('folder'))).toHaveLength(1);
    expect(gs.logs.join('\n')).toContain(`folders/${id}`);
  });
});

describe('login and tokens', () => {
  it('right password gives a 12-hour token; wrong ones are refused', () => {
    const clock = { now: 1_700_000_000_000 };
    const gs = loadFilesScript({ password: PASSWORD, clock });
    expect(gs.post({ action: 'login', password: 'nope' })).toEqual({ ok: false, error: 'wrong' });
    const res = gs.post({ action: 'login', password: PASSWORD });
    expect(res).toMatchObject({ ok: true, ttl: SESSION });
    expect(res.token).not.toContain(PASSWORD);
    expect(gs.post({ action: 'check', token: res.token })).toEqual({ ok: true, ttl: SESSION });
    clock.now += SESSION;
    expect(gs.post({ action: 'check', token: res.token }).error).toBe('expired');
  });

  it('changing UPLOAD_PASSWORD ends every token', () => {
    const { gs, token } = setup();
    gs.props.set('UPLOAD_PASSWORD', 'new-pass');
    expect(gs.post({ action: 'check', token }).error).toBe('changed');
    expect(gs.post({ token, action: 'addText', text: 'hi' }).error).toBe('changed');
  });

  it('no password set → not-configured', () => {
    expect(loadFilesScript().post({ action: 'login', password: 'x' }).error).toBe('not-configured');
  });

  it('blocks logins after 30 wrong passwords for 10 minutes', () => {
    const clock = { now: 1_700_000_000_000 };
    const gs = loadFilesScript({ password: PASSWORD, clock });
    for (let i = 0; i < 30; i++) gs.post({ action: 'login', password: 'wrong' });
    expect(gs.post({ action: 'login', password: PASSWORD }).error).toBe('too-many');
    clock.now += 601_000;
    expect(gs.post({ action: 'login', password: PASSWORD }).ok).toBe(true);
  });

  it('every write needs a valid token', () => {
    const gs = loadFilesScript({ password: PASSWORD });
    for (const action of ['start', 'chunk', 'status', 'cancel', 'addText', 'delete']) {
      expect(gs.post({ action }).error, action).toBe('invalid');
      expect(gs.post({ action, token: '1.2.3' }).error, action).toBe('invalid');
    }
  });

  it('bad JSON and unknown actions are bad requests', () => {
    const { gs, call } = setup();
    expect(gs.post('not json')).toEqual({ ok: false, error: 'bad-request' });
    expect(gs.post('null')).toEqual({ ok: false, error: 'bad-request' });
    expect(call({ action: 'nope' })).toEqual({ ok: false, error: 'bad-request' });
  });
});

describe('list', () => {
  it('is public and empty before the first upload, without making the folder', () => {
    const gs = loadFilesScript({ password: PASSWORD });
    expect(gs.post({ action: 'list' })).toEqual({ ok: true, items: [], used: 0, limit: 1024 * MIB });
    expect(gs.props.has('FOLDER_ID')).toBe(false);
  });

  it('lists newest first with sizes, skips sub-folders and pages through Drive', () => {
    const { gs, call } = setup({ drive: new FakeDrive({ pageSize: 2 }) });
    upload(call, 'a.bin', bytes(10));
    call({ action: 'addText', text: 'hello\nworld' });
    upload(call, 'c.bin', bytes(30));
    gs.drive.addFile({ name: 'sub', mimeType: 'application/vnd.google-apps.folder', parents: [gs.props.get('FOLDER_ID')] });
    const list = gs.post({ action: 'list' });
    expect(list.items.map((i) => i.name)).toEqual(['c.bin', 'hello.txt', 'a.bin']);
    expect(list.used).toBe(10 + 11 + 30);
    expect(list.items[1]).toMatchObject({ kind: 'text', preview: 'hello\nworld', mimeType: 'text/plain', size: 11 });
    expect(list.items[0]).toMatchObject({ kind: 'file', size: 30 });
    expect(list.items[0]).not.toHaveProperty('preview');
  });

  it('LIMIT_MB changes the limit', () => {
    const gs = loadFilesScript({ password: PASSWORD, props: { LIMIT_MB: '500' } });
    expect(gs.post({ action: 'list' }).limit).toBe(500 * MIB);
  });
});

describe('chunked uploads', () => {
  it('uploads a file in 256 KiB-multiple chunks; it appears only when complete, shared', () => {
    const { gs, call } = setup();
    const data = bytes(700 * KIB + 123);
    const start = call({ action: 'start', name: 'video.mp4', size: data.length, type: 'video/mp4' });
    expect(start).toMatchObject({ ok: true, name: 'video.mp4', chunkBytes: 8 * MIB });
    let r = call({ action: 'chunk', uploadId: start.uploadId, offset: 0, data: b64(data.subarray(0, 512 * KIB)) });
    expect(r).toEqual({ ok: true, done: false, received: 512 * KIB });
    expect(gs.post({ action: 'list' }).items).toEqual([]);
    r = call({ action: 'chunk', uploadId: start.uploadId, offset: 512 * KIB, data: b64(data.subarray(512 * KIB)) });
    expect(r).toMatchObject({ ok: true, done: true, received: data.length, item: { name: 'video.mp4', mimeType: 'video/mp4', size: data.length, kind: 'file' } });
    const file = gs.drive.files.get(r.item.id);
    expect(file.content.equals(data)).toBe(true);
    expect(file.parents).toEqual([gs.props.get('FOLDER_ID')]);
    expect(file.permissions).toEqual([{ type: 'anyone', role: 'reader' }]);
    expect([...gs.props.keys()].filter((k) => k.startsWith('upload:'))).toEqual([]);
    // The Drive session URL never reaches the browser.
    expect(JSON.stringify(start)).not.toContain('upload_id');
  });

  it('status tells where to resume after a lost reply', () => {
    const { call } = setup();
    const data = bytes(600 * KIB);
    const { uploadId } = call({ action: 'start', name: 'x.bin', size: data.length });
    expect(call({ action: 'status', uploadId })).toEqual({ ok: true, done: false, received: 0 });
    call({ action: 'chunk', uploadId, offset: 0, data: b64(data.subarray(0, 256 * KIB)) });
    expect(call({ action: 'status', uploadId })).toEqual({ ok: true, done: false, received: 256 * KIB });
    // Sending the same chunk again is refused by Drive; the page then asks for status.
    expect(call({ action: 'chunk', uploadId, offset: 0, data: b64(data.subarray(0, 256 * KIB)) })).toMatchObject({ ok: false, error: 'drive', status: 400 });
    const done = call({ action: 'chunk', uploadId, offset: 256 * KIB, data: b64(data.subarray(256 * KIB)) });
    expect(done).toMatchObject({ ok: true, done: true });
  });

  it('refuses chunks that aren’t 256 KiB multiples (except the last), too big, or outside the file', () => {
    const { call } = setup();
    const { uploadId } = call({ action: 'start', name: 'x.bin', size: 20 * MIB });
    expect(call({ action: 'chunk', uploadId, offset: 0, data: b64(bytes(1000)) }).error).toBe('bad-request');
    expect(call({ action: 'chunk', uploadId, offset: 0, data: b64(bytes(8 * MIB + 256 * KIB)) }).error).toBe('bad-request');
    expect(call({ action: 'chunk', uploadId, offset: 20 * MIB, data: b64(bytes(256 * KIB)) }).error).toBe('bad-request');
    expect(call({ action: 'chunk', uploadId, offset: -1, data: b64(bytes(256 * KIB)) }).error).toBe('bad-request');
    expect(call({ action: 'chunk', uploadId, offset: 0, data: '' }).error).toBe('bad-request');
  });

  it('an unknown, cancelled or expired upload is gone', () => {
    const clock = { now: 1_700_000_000_000 };
    const { gs, call } = setup({ clock });
    expect(call({ action: 'chunk', uploadId: 'abcdefgh1234', offset: 0, data: b64(bytes(10)) }).error).toBe('upload-gone');
    const a = call({ action: 'start', name: 'a.bin', size: 10 });
    call({ action: 'cancel', uploadId: a.uploadId });
    expect(call({ action: 'status', uploadId: a.uploadId }).error).toBe('upload-gone');
    const b = call({ action: 'start', name: 'b.bin', size: 10 });
    clock.now += 25 * HOUR;
    const token = gs.post({ action: 'login', password: PASSWORD }).token; // the old token expired too
    expect(gs.post({ token, action: 'status', uploadId: b.uploadId }).error).toBe('upload-gone');
  });

  it('a Drive failure is reported, and the chunk can be sent again', () => {
    const { gs, call } = setup();
    const data = bytes(300 * KIB);
    const { uploadId } = call({ action: 'start', name: 'x.bin', size: data.length });
    gs.drive.failNext(503, (method) => method === 'put');
    expect(call({ action: 'chunk', uploadId, offset: 0, data: b64(data.subarray(0, 256 * KIB)) })).toMatchObject({ ok: false, error: 'drive', status: 503 });
    expect(call({ action: 'chunk', uploadId, offset: 0, data: b64(data.subarray(0, 256 * KIB)) }).received).toBe(256 * KIB);
  });

  it('Drive forgetting the session → upload-gone', () => {
    const { gs, call } = setup();
    const { uploadId } = call({ action: 'start', name: 'x.bin', size: 300 * KIB });
    gs.drive.sessions.clear();
    expect(call({ action: 'status', uploadId }).error).toBe('upload-gone');
  });

  it('an empty file is created at once', () => {
    const { gs, call } = setup();
    const r = call({ action: 'start', name: 'empty.txt', size: 0, type: 'text/plain' });
    expect(r).toMatchObject({ ok: true, done: true, item: { name: 'empty.txt', size: 0, kind: 'file' } });
    expect(gs.drive.files.get(r.item.id).permissions).toHaveLength(1);
  });

  it('cleans names and numbers duplicates, counting uploads in progress', () => {
    const { call } = setup();
    expect(upload(call, 'photo.jpg', bytes(5)).item.name).toBe('photo.jpg');
    expect(upload(call, 'PHOTO.jpg', bytes(5)).item.name).toBe('PHOTO (2).jpg');
    const pending = call({ action: 'start', name: 'photo.jpg', size: 300 * KIB });
    expect(pending.name).toBe('photo (3).jpg');
    expect(upload(call, 'photo.jpg', bytes(5)).item.name).toBe('photo (4).jpg');
    expect(upload(call, 'a/b\\c\u0000.txt', bytes(5)).item.name).toBe('a b c .txt');
    expect(upload(call, '   ', bytes(5)).item.name).toBe('file');
    expect(upload(call, 'noext', bytes(5)).item.name).toBe('noext');
    expect(upload(call, 'noext', bytes(5)).item.name).toBe('noext (2)');
  });

  it('bad sizes are refused', () => {
    const { call } = setup();
    for (const size of [-1, 1.5, 'abc', '10', undefined, null]) expect(call({ action: 'start', name: 'x', size }).error, String(size)).toBe('bad-request');
  });
});

describe('size limit', () => {
  it('refuses a file that would go over, counting uploads in progress', () => {
    const { call } = setup({ props: { LIMIT_MB: '1' } });
    expect(upload(call, 'a.bin', bytes(400 * KIB)).ok).toBe(true);
    const b = call({ action: 'start', name: 'b.bin', size: 400 * KIB });
    expect(b.ok).toBe(true);
    // 400 KiB stored + 400 KiB reserved: 300 KiB more doesn't fit.
    expect(call({ action: 'start', name: 'c.bin', size: 300 * KIB })).toEqual({ ok: false, error: 'full', used: 800 * KIB, limit: MIB, size: 300 * KIB });
    expect(call({ action: 'addText', text: '€'.repeat(100_000) })).toMatchObject({ ok: false, error: 'full' }); // 300 kB, 100k characters
    // Cancelling frees the reservation.
    call({ action: 'cancel', uploadId: b.uploadId });
    expect(call({ action: 'start', name: 'c.bin', size: 300 * KIB }).ok).toBe(true);
  });

  it('an exactly full folder is fine; one more byte is not', () => {
    const { call } = setup({ props: { LIMIT_MB: '1' } });
    expect(upload(call, 'a.bin', bytes(MIB - 10)).ok).toBe(true);
    expect(call({ action: 'start', name: 'b', size: 10 }).ok).toBe(true);
    expect(call({ action: 'start', name: 'c', size: 1 }).error).toBe('full');
  });

  it('expired reservations stop counting', () => {
    const clock = { now: 1_700_000_000_000 };
    const { gs, call } = setup({ clock, props: { LIMIT_MB: '1' } });
    call({ action: 'start', name: 'a', size: MIB });
    expect(call({ action: 'start', name: 'b', size: 1 }).error).toBe('full');
    clock.now += 25 * HOUR;
    const token = gs.post({ action: 'login', password: PASSWORD }).token;
    expect(gs.post({ token, action: 'start', name: 'b', size: 1 }).ok).toBe(true);
    expect([...gs.props.keys()].filter((k) => k.startsWith('upload:'))).toHaveLength(1);
  });

  it('deleting frees the space at once', () => {
    const { call } = setup({ props: { LIMIT_MB: '1' } });
    const a = upload(call, 'a.bin', bytes(MIB));
    expect(call({ action: 'start', name: 'b', size: 1 }).error).toBe('full');
    call({ action: 'delete', ids: [a.item.id] });
    expect(call({ action: 'start', name: 'b', size: 1 }).ok).toBe(true);
  });
});

describe('text items', () => {
  it('saves text as a .txt named after its first line, with a preview; anyone can read it', () => {
    const { gs, call } = setup();
    const text = 'Shopping list: milk/eggs\n' + 'line '.repeat(200) + 'नमस्ते 👋';
    const r = call({ action: 'addText', text });
    expect(r.item).toMatchObject({ kind: 'text', name: 'Shopping list: milk eggs.txt', mimeType: 'text/plain' });
    expect(r.item.preview).toBe(text.slice(0, 300));
    expect(r.item.size).toBe(Buffer.byteLength(text));
    expect(gs.post({ action: 'text', id: r.item.id })).toEqual({ ok: true, text });
  });

  it('long first lines are cut; blank or huge text is refused', () => {
    const { call } = setup();
    expect(call({ action: 'addText', text: 'a'.repeat(100) }).item.name).toBe('a'.repeat(40) + '.txt');
    expect(call({ action: 'addText', text: '\n\nsecond' }).item.name).toBe('Text.txt');
    expect(call({ action: 'addText', text: 'notes.txt' }).item.name).toBe('notes.txt');
    expect(call({ action: 'addText', text: '   \n ' }).error).toBe('bad-request');
    expect(call({ action: 'addText', text: 42 }).error).toBe('bad-request');
    expect(call({ action: 'addText', text: 'x'.repeat(200_001) })).toEqual({ ok: false, error: 'too-long', max: 200_000 });
  });

  it('text only reads text items inside the folder', () => {
    const { gs, call } = setup();
    const file = upload(call, 'a.bin', bytes(10));
    const outside = gs.drive.addFile({ name: 'secret.txt', mimeType: 'text/plain', parents: ['root'], appProperties: { kind: 'text' } }, 'secret');
    for (const id of [file.item.id, outside.id, 'nope', '../x', '']) expect(gs.post({ action: 'text', id }).error, id).toBe('not-found');
  });
});

describe('delete', () => {
  it('deletes permanently, only inside the folder', () => {
    const { gs, call } = setup();
    const a = upload(call, 'a.bin', bytes(10));
    const t = call({ action: 'addText', text: 'note' });
    const outside = gs.drive.addFile({ name: 'mine.doc', mimeType: 'text/plain', parents: ['root'] }, 'keep me');
    const r = call({ action: 'delete', ids: [a.item.id, t.item.id, outside.id, 'gone123', '../bad'] });
    expect(r).toEqual({ ok: true, deleted: [a.item.id, t.item.id], missing: ['gone123'], refused: [outside.id, '../bad'] });
    expect(gs.drive.files.has(a.item.id)).toBe(false);
    expect(gs.drive.files.has(outside.id)).toBe(true);
    expect(gs.post({ action: 'list' }).items).toEqual([]);
  });

  it('needs a non-empty list of at most 200 ids', () => {
    const { call } = setup();
    for (const ids of [undefined, [], 'abc', Array(201).fill('x')]) expect(call({ action: 'delete', ids }).error).toBe('bad-request');
  });
});

describe('errors', () => {
  it('a Drive failure while listing comes back as a server error, not a crash', () => {
    const { gs, call } = setup();
    upload(call, 'a.bin', bytes(10));
    gs.drive.failNext(500, (method, url) => method === 'get' && url.includes('/files?'));
    expect(gs.post({ action: 'list' })).toMatchObject({ ok: false, error: 'server' });
    expect(gs.post({ action: 'list' }).ok).toBe(true);
  });
});
