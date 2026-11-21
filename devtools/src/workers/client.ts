// Promise wrapper around the compute worker with per-call timeouts and "latest wins" cancelling.
// Terminating the worker is the only way to stop a runaway job (e.g. catastrophic regex
// backtracking), so a timed-out or superseded job kills the worker; a fresh one is created
// on the next call.
import type { OpName, Ops, WorkerRequest, WorkerResponse } from './protocol';

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms / 1000}s`);
  }
}

export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
  }
}

/** The subset of the Worker API the client uses (lets tests inject a fake). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

const defaultFactory: WorkerFactory = () => new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Kill a worker that is still busy with earlier jobs instead of queueing behind them. */
  latestWins?: boolean;
}

export class ComputeClient {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(private factory: WorkerFactory = defaultFactory) {}

  /** True while at least one job is in flight. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.factory();
    w.onmessage = (e) => {
      if (this.worker !== w) return; // message from a terminated worker
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      clearTimeout(p.timer);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      if (this.worker !== w) return;
      this.terminate(new Error(e.message || 'Background worker failed to start'));
    };
    this.worker = w;
    return w;
  }

  private failAll(err: Error) {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  run<K extends OpName>(op: K, payload: Ops[K]['req'], opts: RunOptions = {}): Promise<Ops[K]['res']> {
    if (opts.latestWins && this.busy) this.cancel();
    const id = this.nextId++;
    const w = this.ensure();
    return new Promise<Ops[K]['res']>((resolve, reject) => {
      const p: Pending = { resolve: resolve as (v: unknown) => void, reject };
      const { timeoutMs } = opts;
      if (timeoutMs) {
        p.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new TimeoutError(timeoutMs));
          // Kill the stuck worker; other in-flight calls are cancelled too.
          this.terminate(new CancelledError());
        }, timeoutMs);
      }
      this.pending.set(id, p);
      const msg: WorkerRequest<K> = { id, op, payload };
      w.postMessage(msg);
    });
  }

  /** Cancel every in-flight job (terminating the worker if it is busy). */
  cancel() {
    if (this.busy) this.terminate(new CancelledError());
  }

  terminate(reason: Error = new CancelledError()) {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(reason);
  }
}
