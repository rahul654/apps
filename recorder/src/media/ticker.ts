/**
 * setInterval that keeps running in background tabs (backed by a dedicated worker).
 * Main-thread timers are throttled in hidden tabs and requestAnimationFrame stops; dedicated
 * worker timers aren't. Falls back to main-thread setInterval if the worker can't start
 * (the registered timers are moved over if it fails later).
 */

interface Reg {
  interval: number;
  fn: () => void;
  fallback?: ReturnType<typeof setInterval>;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const regs = new Map<number, Reg>();

function failOver() {
  if (workerFailed) return;
  workerFailed = true;
  worker?.terminate();
  worker = null;
  for (const r of regs.values()) r.fallback ??= setInterval(r.fn, r.interval);
}

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('../workers/tick.worker.ts', import.meta.url), { type: 'module', name: 'recorder-ticker' });
    worker.onmessage = (e: MessageEvent<{ type: 'tick'; id: number }>) => regs.get(e.data.id)?.fn();
    worker.onerror = () => failOver();
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** Calls `fn` every `intervalMs`. Returns a stop function. */
export function every(intervalMs: number, fn: () => void): () => void {
  const id = nextId++;
  const reg: Reg = { interval: intervalMs, fn };
  regs.set(id, reg);
  const wk = getWorker();
  if (wk) wk.postMessage({ type: 'start', id, interval: intervalMs });
  else reg.fallback = setInterval(fn, intervalMs);
  return () => {
    const r = regs.get(id);
    if (!r) return;
    regs.delete(id);
    if (r.fallback !== undefined) clearInterval(r.fallback);
    worker?.postMessage({ type: 'stop', id });
  };
}
