import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError, ComputeClient, TimeoutError, type WorkerLike } from './client';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Fake worker: records messages; the test decides when (or whether) each job replies. */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  received: WorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: unknown) {
    this.received.push(msg as WorkerRequest);
  }
  terminate() {
    this.terminated = true;
  }
  reply(index: number, result: unknown) {
    this.onmessage?.({ data: { id: this.received[index].id, ok: true, result } } as MessageEvent<WorkerResponse>);
  }
}

const regexReq = (pattern: string) => ({ pattern, flags: 'g', text: 'aaa' });

afterEach(() => {
  FakeWorker.all = [];
  vi.useRealTimers();
});

describe('ComputeClient', () => {
  it('resolves replies by id and reuses one worker', async () => {
    const c = new ComputeClient(() => new FakeWorker());
    const p1 = c.run('regex', regexReq('a'));
    const p2 = c.run('regex', regexReq('b'));
    expect(FakeWorker.all).toHaveLength(1);
    expect(c.busy).toBe(true);
    const w = FakeWorker.all[0];
    w.reply(1, 'second');
    w.reply(0, 'first');
    await expect(p1).resolves.toBe('first');
    await expect(p2).resolves.toBe('second');
    expect(c.busy).toBe(false);
  });

  it('latestWins kills a busy worker and runs the new job on a fresh one immediately', async () => {
    const c = new ComputeClient(() => new FakeWorker());
    const stuck = c.run('regex', regexReq('(a+)+$'), { timeoutMs: 1500, latestWins: true });
    const next = c.run('regex', regexReq('(?<run>a{3})'), { timeoutMs: 1500, latestWins: true });
    await expect(stuck).rejects.toBeInstanceOf(CancelledError);
    const [old, fresh] = FakeWorker.all;
    expect(old.terminated).toBe(true);
    expect(fresh.terminated).toBe(false);
    expect(fresh.received.map((r) => (r.payload as { pattern: string }).pattern)).toEqual(['(?<run>a{3})']);
    fresh.reply(0, 'ok');
    await expect(next).resolves.toBe('ok');
  });

  it('ignores late messages from a terminated worker', async () => {
    const c = new ComputeClient(() => new FakeWorker());
    const first = c.run('regex', regexReq('x'), { latestWins: true });
    first.catch(() => {});
    const second = c.run('regex', regexReq('y'), { latestWins: true });
    const [old, fresh] = FakeWorker.all;
    // The killed worker's reply carries id 1; it must not resolve anything on the new worker.
    old.reply(0, 'stale');
    fresh.reply(0, 'fresh');
    await expect(second).resolves.toBe('fresh');
  });

  it('without latestWins, an idle worker is reused (no needless restarts)', async () => {
    const c = new ComputeClient(() => new FakeWorker());
    const p = c.run('regex', regexReq('a'), { latestWins: true });
    FakeWorker.all[0].reply(0, 1);
    await p;
    const q = c.run('regex', regexReq('b'), { latestWins: true });
    expect(FakeWorker.all).toHaveLength(1);
    FakeWorker.all[0].reply(1, 2);
    await expect(q).resolves.toBe(2);
  });

  it('times out, terminates the worker and recovers on the next call', async () => {
    vi.useFakeTimers();
    const c = new ComputeClient(() => new FakeWorker());
    const p = c.run('regex', regexReq('(a+)+$'), { timeoutMs: 1500 });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(1500);
    await assertion;
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(c.busy).toBe(false);
    const q = c.run('regex', regexReq('a'));
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].reply(0, 'back');
    await expect(q).resolves.toBe('back');
  });

  it('cancel() is a no-op when idle and rejects in-flight jobs otherwise', async () => {
    const c = new ComputeClient(() => new FakeWorker());
    c.cancel();
    expect(FakeWorker.all).toHaveLength(0);
    const p = c.run('regex', regexReq('a'));
    c.cancel();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(FakeWorker.all[0].terminated).toBe(true);
  });
});
