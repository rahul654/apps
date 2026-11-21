import { describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK, HIGH_WATER, parseCtl, Receiver, sendCtl, sendFile, type ChannelLike, type ReceiverEvents } from './protocol';

/**
 * A data channel stand-in: send() queues messages (raising bufferedAmount) and a timer delivers
 * them to the receiver in order, firing `bufferedamountlow` like a browser does.
 */
class FakeChannel implements ChannelLike {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  maxBuffered = 0;
  sent: (string | ArrayBuffer)[] = [];
  private queue: (string | ArrayBuffer)[] = [];
  private listeners: Record<string, Set<() => void>> = { bufferedamountlow: new Set(), close: new Set() };
  constructor(private readonly deliver: (d: string | ArrayBuffer) => void) {}
  send(data: string | ArrayBuffer) {
    if (this.readyState !== 'open') throw new Error('InvalidStateError');
    this.sent.push(data);
    this.queue.push(data);
    this.bufferedAmount += typeof data === 'string' ? data.length : data.byteLength;
    this.maxBuffered = Math.max(this.maxBuffered, this.bufferedAmount);
    setTimeout(() => this.flush(), 0);
  }
  private flush() {
    while (this.queue.length) {
      const d = this.queue.shift()!;
      const before = this.bufferedAmount;
      this.bufferedAmount -= typeof d === 'string' ? d.length : d.byteLength;
      this.deliver(d);
      if (before > this.bufferedAmountLowThreshold && this.bufferedAmount <= this.bufferedAmountLowThreshold) this.listeners.bufferedamountlow.forEach((f) => f());
    }
  }
  close() {
    this.readyState = 'closed';
    this.queue = [];
    this.listeners.close.forEach((f) => f());
  }
  addEventListener(type: 'bufferedamountlow' | 'close', fn: () => void) {
    this.listeners[type].add(fn);
  }
  removeEventListener(type: 'bufferedamountlow' | 'close', fn: () => void) {
    this.listeners[type].delete(fn);
  }
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24;
  return b;
}

function setup(extra: ReceiverEvents = {}) {
  const log: string[] = [];
  const done = new Map<string, Blob>();
  const progress: number[] = [];
  const rx = new Receiver({
    onFileStart: (m) => log.push(`start ${m.id} ${m.name} ${m.size}`),
    onProgress: (_id, n) => progress.push(n),
    onFileDone: (id, blob) => {
      log.push(`done ${id}`);
      done.set(id, blob);
    },
    onFileCancelled: (id) => log.push(`cancelled ${id}`),
    onFileFailed: (id, r) => log.push(`failed ${id} ${r}`),
    onText: (id, t) => log.push(`text ${id} ${t}`),
    ...extra,
  });
  const ch = new FakeChannel((d) => rx.handle(d));
  const settle = () => new Promise((r) => setTimeout(r, 5));
  return { rx, ch, log, done, progress, settle };
}

describe('sendFile + Receiver', () => {
  it('transfers a multi-chunk file byte for byte', async () => {
    const { ch, log, done, progress, settle } = setup();
    const data = randomBytes(3 * 1024 * 1024 + 123);
    const result = await sendFile(ch, new Blob([data], { type: 'video/mp4' }), { id: 'f1', name: 'clip.mp4' });
    await settle();
    expect(result).toBe('done');
    expect(log).toEqual([`start f1 clip.mp4 ${data.length}`, 'done f1']);
    const got = new Uint8Array(await done.get('f1')!.arrayBuffer());
    expect(got.length).toBe(data.length);
    expect(got).toEqual(data);
    expect(done.get('f1')!.type).toBe('video/mp4');
    expect(progress.at(-1)).toBe(data.length);
    // Every binary message is at most one chunk.
    expect(ch.sent.filter((d) => typeof d !== 'string').every((d) => (d as ArrayBuffer).byteLength <= DEFAULT_CHUNK)).toBe(true);
  });

  it('handles empty files', async () => {
    const { ch, log, done, settle } = setup();
    await sendFile(ch, new Blob([]), { id: 'e', name: 'empty.txt' });
    await settle();
    expect(log).toEqual(['start e empty.txt 0', 'done e']);
    expect(done.get('e')!.size).toBe(0);
  });

  it('waits for the buffer to drain instead of queueing the whole file', async () => {
    const { ch, settle } = setup();
    const data = randomBytes(24 * 1024 * 1024);
    await sendFile(ch, new Blob([data]), { id: 'big', name: 'big.bin' });
    await settle();
    expect(ch.maxBuffered).toBeLessThanOrEqual(HIGH_WATER + 64 * 1024 + 1024);
  });

  it('stops when the sender cancels, and the receiver reports it', async () => {
    const { ch, log, settle } = setup();
    let chunks = 0;
    const result = await sendFile(ch, new Blob([randomBytes(2 * 1024 * 1024)]), { id: 'c', name: 'c.bin' }, { isCancelled: () => ++chunks > 5 });
    await settle();
    expect(result).toBe('cancelled');
    expect(log).toEqual(['start c c.bin 2097152', 'cancelled c']);
  });

  it('drops bytes after the receiver cancels until the sender ends', async () => {
    // The receiver cancels after 1 MiB arrived; its `cancel` message reaches the sender as a flag.
    let cancelRequested = false;
    const { rx, ch, log, settle } = setup({
      onProgress: (id, n) => {
        if (n >= 1024 * 1024 && !cancelRequested) cancelRequested = rx.cancel(id);
      },
    });
    const size = 24 * 1024 * 1024; // larger than HIGH_WATER, so delivery interleaves with sending
    const result = await sendFile(ch, new Blob([randomBytes(size)]), { id: 'r', name: 'r.bin' }, { isCancelled: () => cancelRequested });
    await settle();
    expect(cancelRequested).toBe(true);
    expect(result).toBe('cancelled');
    expect(log).toEqual([`start r r.bin ${size}`, 'cancelled r']);
    expect(rx.currentId).toBeNull();
  });

  it('sends several files and texts in order', async () => {
    const { ch, log, settle } = setup();
    sendCtl(ch, { t: 'text', id: 't1', text: 'hello' });
    await sendFile(ch, new Blob(['abc']), { id: 'a', name: 'a.txt' });
    await sendFile(ch, new Blob(['defg']), { id: 'b', name: 'b.txt' });
    await settle();
    expect(log).toEqual(['text t1 hello', 'start a a.txt 3', 'done a', 'start b b.txt 4', 'done b']);
  });

  it('rejects when the channel closes mid-file, and the receiver can abort', async () => {
    let ch!: FakeChannel;
    const { rx, log, settle, ch: channel } = setup({
      // The connection drops once the receiver has 1 MiB of the file.
      onProgress: (_id, n) => {
        if (n >= 1024 * 1024 && ch.readyState === 'open') ch.close();
      },
    });
    ch = channel;
    const p = sendFile(ch, new Blob([randomBytes(20 * 1024 * 1024)]), { id: 'x', name: 'x.bin' });
    await expect(p).rejects.toThrow(/closed/);
    await settle();
    rx.abort('Connection lost');
    expect(log.at(-1)).toBe('failed x Connection lost');
  });

  it('fails a file whose byte count does not match', async () => {
    const { rx, log } = setup();
    rx.handle(JSON.stringify({ t: 'file', id: 'm', name: 'm', size: 10, mime: 'text/plain' }));
    rx.handle(new Uint8Array(4).buffer);
    rx.handle(JSON.stringify({ t: 'end', id: 'm' }));
    expect(log.at(-1)).toBe('failed m Received 4 of 10 bytes.');
    rx.handle(JSON.stringify({ t: 'file', id: 'o', name: 'o', size: 2, mime: '' }));
    rx.handle(new Uint8Array(3).buffer);
    expect(log.at(-1)).toBe('failed o Received more data than announced.');
  });
});

describe('parseCtl', () => {
  it('accepts valid messages and rejects malformed or hostile ones', () => {
    expect(parseCtl('{"t":"ack","id":"abc"}')).toEqual({ t: 'ack', id: 'abc' });
    expect(parseCtl('{"t":"end","id":"a","cancelled":true}')).toEqual({ t: 'end', id: 'a', cancelled: true });
    expect(parseCtl('{"t":"hello","v":1,"name":"Pixel"}')).toEqual({ t: 'hello', v: 1, name: 'Pixel' });
    expect(parseCtl('not json')).toBeNull();
    expect(parseCtl('null')).toBeNull();
    expect(parseCtl('{"t":"file","id":"a","name":"x","size":-1,"mime":""}')).toBeNull();
    expect(parseCtl('{"t":"file","id":"a","name":"x","size":1.5,"mime":""}')).toBeNull();
    expect(parseCtl('{"t":"ack","id":"../../etc"}')).toBeNull();
    expect(parseCtl(JSON.stringify({ t: 'file', id: 'a', name: 'x'.repeat(300), size: 1, mime: '' }))).toBeNull();
    expect(parseCtl('{"t":"exec","cmd":"rm"}')).toBeNull();
  });
});
