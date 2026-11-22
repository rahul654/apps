// The upload queue. Up to MAX_PARALLEL files upload at the same time, started smallest first;
// when one finishes, the next smallest waiting file starts in its place. Each file goes in chunks
// of up to 8 MiB, in order (Drive's resumable upload needs that), sent to the Apps Script, which
// passes them on to Drive. MAX_INFLIGHT_BYTES caps the chunk data held in memory across all
// uploads (each chunk also exists as a ~1.33× base64 string while it's sent), so ten big videos
// don't use hundreds of MB on a phone.
//
// - A failed chunk (network, timeout, Google hiccup) is retried after 2, 5, 10 and 20 s; before
//   each retry the script is asked how much Drive already has (`status`), so a chunk whose reply
//   was lost isn't sent twice. After that the queue pauses with a Retry button.
// - The login running out mid-upload pauses the queue and opens the password dialog; after
//   logging in it continues from the last chunk Drive has.
// - Drive forgetting the upload (`upload-gone`) restarts that file from 0 (twice at most).
// - `full` skips the file: the folder has no room for it. Bigger files after it won't fit either,
//   but they're still tried, since the space can change (deletes on another device).
// The queue lives outside React, so it keeps going while the page changes.
import { ApiError, callScript, MESSAGES } from '../lib/api';
import { SCRIPT_URL } from '../lib/env';
import { formatBytes } from '../lib/format';
import { parseItem, type Item } from '../lib/items';
import { bySizeAscending, bytesToBase64, chunkAt, chunkSizeFrom, fits, MAX_CHUNK, retryDelay } from '../lib/upload';
import { auth, currentToken, endSession, openLogin } from './auth';
import { createStore } from './createStore';
import { addItem, library } from './library';
import { toast } from './toasts';

export type JobState = 'queued' | 'uploading' | 'paused' | 'done' | 'failed' | 'skipped';

export type Job = {
  id: string;
  seq: number;
  file: File;
  name: string;
  size: number;
  type: string;
  state: JobState;
  received: number;
  uploadId?: string;
  chunkBytes: number;
  error?: string;
  item?: Item;
};

type UploadsState = {
  jobs: Job[];
  /** Why the queue is stopped: waiting for the password, or gave up retrying */
  pause: null | 'login' | 'error';
  pauseMessage?: string;
  /** Bytes per second, smoothed */
  speed: number;
};

export const uploads = createStore<UploadsState>({ jobs: [], pause: null, speed: 0 });

/** Files uploading at the same time. */
export const MAX_PARALLEL = 10;
/** Raw chunk bytes read and in flight at once, across all uploads (4 full 8 MiB chunks). */
export const MAX_INFLIGHT_BYTES = 32 * 1024 * 1024;
const START_TIMEOUT = 60_000;
const CHUNK_TIMEOUT = 180_000; // ~11 MB of base64 on a slow phone connection
const MAX_RESTARTS = 2;

let seq = 0;
/** Jobs being uploaded now → their cancel switch. */
const active = new Map<string, AbortController>();
let finishedThisRun = 0;

// Shared budget for chunk bytes in memory. A chunk waits until it fits (one always fits when
// nothing else is in flight).
let inflight = 0;
let budgetWaiters: (() => void)[] = [];
async function reserveBytes(n: number) {
  while (inflight > 0 && inflight + n > MAX_INFLIGHT_BYTES) await new Promise<void>((r) => budgetWaiters.push(r));
  inflight += n;
}
function releaseBytes(n: number) {
  inflight -= n;
  const waiting = budgetWaiters;
  budgetWaiters = [];
  for (const w of waiting) w();
}

// Overall speed: bytes acknowledged by Drive over the last ~10 s, across all uploads.
let samples: { t: number; bytes: number }[] = [];
function recordProgress(bytes: number) {
  const now = performance.now();
  samples = [...samples.filter((x) => now - x.t < 10_000), { t: now, bytes }];
  const span = (now - samples[0].t) / 1000;
  if (samples.length > 1 && span > 0.5) {
    const total = samples.slice(1).reduce((n, x) => n + x.bytes, 0);
    uploads.set((s) => ({ ...s, speed: total / span }));
  }
}

function patch(id: string, change: Partial<Job>) {
  uploads.set((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...change } : j)) }));
}
const job = (id: string) => uploads.get().jobs.find((j) => j.id === id);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

/** Adds files to the queue (they go in smallest-first order) and starts it. */
export function addFiles(files: Iterable<File>) {
  const added: Job[] = [...files].map((file) => ({
    id: `j${++seq}-${Math.random().toString(36).slice(2, 8)}`,
    seq,
    file,
    name: file.name || 'file',
    size: file.size,
    type: file.type || 'application/octet-stream',
    state: 'queued',
    received: 0,
    chunkBytes: MAX_CHUNK,
  }));
  if (!added.length) return;
  uploads.set((s) => ({ ...s, jobs: [...s.jobs, ...added] }));
  kick();
}

/** What uploads next (not already running): interrupted files first, then the smallest queued one. */
function nextJob(): Job | undefined {
  const waiting = uploads.get().jobs.filter((j) => !active.has(j.id));
  return waiting.find((j) => j.state === 'paused' || j.state === 'uploading') ?? bySizeAscending(waiting.filter((j) => j.state === 'queued'))[0];
}

/** Fills free upload slots with waiting files. */
function kick() {
  for (let j = nextJob(); j && !uploads.get().pause && active.size < MAX_PARALLEL; j = nextJob()) {
    const id = j.id;
    const abort = new AbortController();
    active.set(id, abort);
    if (active.size === 1) wakeLock.take();
    void runJob(id, abort)
      .then((r) => {
        if (r === 'done') finishedThisRun++;
      })
      .finally(() => {
        active.delete(id);
        kick();
        if (!active.size) idle();
      });
  }
}

/** Nothing uploading any more: let the screen sleep, and say how it went. */
function idle() {
  wakeLock.release();
  const s = uploads.get();
  const finished = finishedThisRun;
  if (s.pause || s.jobs.some((j) => j.state === 'queued')) return;
  finishedThisRun = 0;
  if (!finished) return;
  const failed = s.jobs.filter((j) => j.state === 'failed' || j.state === 'skipped').length;
  toast(failed ? `Uploads finished: ${failed} couldn’t be uploaded.` : `${finished} file${finished === 1 ? '' : 's'} uploaded.`, failed ? 'error' : 'ok');
}

function pause(why: 'login' | 'error', message: string, id: string) {
  patch(id, { state: 'paused', error: message });
  if (uploads.get().pause) return; // another upload already paused the queue
  uploads.set((s) => ({ ...s, pause: why, pauseMessage: message }));
  if (why === 'login') openLogin(message);
}

/** Space the other running uploads will take (not yet in the library's `used`). */
function reservedByOthers(id: string): number {
  return uploads.get().jobs.reduce((n, j) => (j.id !== id && active.has(j.id) && j.state !== 'done' ? n + j.size : n), 0);
}

/** Uploads one job until it's done, failed, skipped, paused or cancelled. */
async function runJob(id: string, abort: AbortController): Promise<'done' | 'stopped'> {
  let attempts = 0;
  let restarts = 0;
  // Resuming (after a pause or failed chunk): ask Drive how much it has before sending more.
  let needStatus = Boolean(job(id)?.uploadId);
  patch(id, { state: 'uploading', error: undefined });

  for (;;) {
    const j = job(id);
    if (!j || abort.signal.aborted) return 'stopped';
    if (uploads.get().pause) {
      // Another upload paused the queue (login ended, or it gave up retrying): stop here too.
      patch(id, { state: 'paused' });
      return 'stopped';
    }
    const token = currentToken();
    if (!token) {
      pause('login', MESSAGES.expired, id);
      return 'stopped';
    }
    const call = <T extends object>(body: Record<string, unknown>, timeoutMs: number) =>
      callScript<T>({ ...body, token }, { url: SCRIPT_URL, timeoutMs, signal: abort.signal });

    try {
      if (!j.uploadId) {
        const { limit } = library.get();
        const used = library.get().used + reservedByOthers(id);
        if (!fits(j.size, used, limit)) {
          patch(id, { state: 'skipped', error: `Not enough space: needs ${formatBytes(j.size)}, ${formatBytes(Math.max(0, limit - used))} left.` });
          return 'stopped';
        }
        const r = await call<{ uploadId?: string; chunkBytes?: number; done?: boolean; item?: unknown }>({ action: 'start', name: j.name, size: j.size, type: j.type }, START_TIMEOUT);
        if (r.done) return finish(id, r.item);
        patch(id, { uploadId: String(r.uploadId), chunkBytes: chunkSizeFrom(r.chunkBytes), received: 0 });
        needStatus = false;
        continue;
      }

      if (needStatus) {
        const r = await call<{ done?: boolean; received?: number; item?: unknown }>({ action: 'status', uploadId: j.uploadId }, START_TIMEOUT);
        if (r.done) return finish(id, r.item);
        patch(id, { received: Number(r.received) || 0 });
        needStatus = false;
        continue;
      }

      const { start, end } = chunkAt(j.received, j.size, j.chunkBytes);
      await reserveBytes(end - start);
      let r: { done?: boolean; received?: number; item?: unknown };
      try {
        if (abort.signal.aborted) return 'stopped';
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await j.file.slice(start, end).arrayBuffer());
        } catch {
          patch(id, { state: 'failed', error: 'Couldn’t read the file from this device (was it moved or deleted?).' });
          return 'stopped';
        }
        r = await call<{ done?: boolean; received?: number; item?: unknown }>({ action: 'chunk', uploadId: j.uploadId, offset: start, data: bytesToBase64(bytes) }, CHUNK_TIMEOUT);
      } finally {
        releaseBytes(end - start);
      }
      recordProgress(end - start);
      attempts = 0;
      if (r.done) return finish(id, r.item);
      patch(id, { received: Number(r.received) || end });
    } catch (err) {
      if (abort.signal.aborted) return 'stopped';
      const e = err instanceof ApiError ? err : new ApiError('server');
      if (e.isAuth) {
        endSession(e.code);
        pause('login', e.message, id);
        return 'stopped';
      }
      if (e.code === 'full') {
        const r: Record<string, unknown> = e.reply ?? {};
        const left = Math.max(0, Number(r.limit) - Number(r.used));
        patch(id, { state: 'skipped', error: `Not enough space: needs ${formatBytes(j.size)}, ${formatBytes(left)} left.` });
        return 'stopped';
      }
      if (e.code === 'upload-gone') {
        if (++restarts > MAX_RESTARTS) {
          patch(id, { state: 'failed', error: 'Google kept dropping this upload. Try it again later.' });
          return 'stopped';
        }
        patch(id, { uploadId: undefined, received: 0 });
        continue;
      }
      if (e.isTransient) {
        const wait = retryDelay(++attempts);
        if (wait === null) {
          pause('error', `${e.message} Upload paused.`, id);
          return 'stopped';
        }
        patch(id, { error: `${e.message} Retrying in ${wait / 1000} s…` });
        await sleep(wait, abort.signal);
        if (j.uploadId) needStatus = true;
        patch(id, { error: undefined });
        continue;
      }
      patch(id, { state: 'failed', error: e.message });
      return 'stopped';
    }
  }
}

function finish(id: string, raw: unknown): 'done' {
  const item = parseItem(raw);
  const j = job(id);
  patch(id, { state: 'done', received: j?.size ?? 0, item: item ?? undefined, error: undefined, uploadId: undefined });
  if (item) addItem(item);
  return 'done';
}

/** Continues after a pause (login done, or Retry). */
export function resume() {
  uploads.set((s) => ({ ...s, pause: null, pauseMessage: undefined }));
  kick();
}

/** Removes a job; an unfinished upload is cancelled on Google's side too. */
export function cancelJob(id: string) {
  const j = job(id);
  if (!j) return;
  active.get(id)?.abort();
  const token = currentToken();
  if (j.uploadId && token) void callScript({ action: 'cancel', token, uploadId: j.uploadId }, { url: SCRIPT_URL }).catch(() => {});
  uploads.set((s) => {
    const jobs = s.jobs.filter((x) => x.id !== id);
    const stillPaused = jobs.some((x) => x.state === 'paused');
    return { ...s, jobs, pause: stillPaused ? s.pause : null, pauseMessage: stillPaused ? s.pauseMessage : undefined };
  });
  kick();
}

/** Puts a failed or skipped file back in the queue. */
export function retryJob(id: string) {
  patch(id, { state: 'queued', error: undefined, received: 0, uploadId: undefined });
  kick();
}

export function clearFinished() {
  uploads.set((s) => ({ ...s, jobs: s.jobs.filter((j) => j.state !== 'done' && j.state !== 'failed' && j.state !== 'skipped') }));
}

/** True while something is uploading or waiting to. */
export function hasPendingUploads(): boolean {
  return uploads.get().jobs.some((j) => j.state === 'queued' || j.state === 'uploading' || j.state === 'paused');
}

// Logging in again resumes a queue that paused for it.
auth.subscribe(() => {
  if (auth.get().session && uploads.get().pause === 'login') resume();
});

/** Keeps the phone's screen on while uploading (a locked phone pauses the page). */
const wakeLock = (() => {
  let sentinel: { release: () => Promise<void> } | null = null;
  let wanted = false;
  const request = async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wanted && !sentinel && wl && document.visibilityState === 'visible') sentinel = await wl.request('screen');
    } catch {
      /* not allowed or not supported */
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        sentinel = null; // the browser drops it when the page is hidden
        void request();
      }
    });
  }
  return {
    take() {
      wanted = true;
      void request();
    },
    release() {
      wanted = false;
      void sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
})();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (hasPendingUploads()) e.preventDefault();
  });
}
