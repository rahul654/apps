/**
 * Runs image jobs: in a small pool of module workers (OffscreenCanvas) when the
 * browser supports it, otherwise — or when the worker can't decode a format — on
 * the main thread.
 */
import { sniffType } from '../sniff';
import { decodeBitmap, processDrawable, UnsupportedOutputError, type ImageJobOptions, type ImageJobResult, type OutputFormat } from './process';
import type { WorkerRequest, WorkerResponse } from './image.worker';

let encodeSupportCache: Promise<Record<OutputFormat, boolean>> | null = null;

/** Which output formats canvas can actually encode here (Safari can't do WebP; few can do AVIF). */
export function detectEncodeSupport(): Promise<Record<OutputFormat, boolean>> {
  encodeSupportCache ??= (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')?.fillRect(0, 0, 1, 1);
    const test = (type: string) => new Promise<boolean>((res) => canvas.toBlob((b) => res(!!b && b.type === type), type, 0.8));
    const [webp, avif] = await Promise.all([test('image/webp'), test('image/avif')]);
    return { 'image/jpeg': true, 'image/png': true, 'image/webp': webp, 'image/avif': avif };
  })();
  return encodeSupportCache;
}

function workerCapable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'convertToBlob' in OffscreenCanvas.prototype && typeof createImageBitmap === 'function';
}

type Pending = { resolve: (r: WorkerResponse) => void };

class ImageWorkerPool {
  private workers: { worker: Worker; busy: boolean }[] = [];
  private queue: { req: Omit<WorkerRequest, 'id'>; done: Pending }[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  broken = false;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      try {
        const worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
        const slot = { worker, busy: false };
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          slot.busy = false;
          const p = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          p?.resolve(e.data);
          this.pump();
        };
        worker.onerror = () => {
          // Module workers unsupported or the script failed to load: fall back to main thread.
          this.broken = true;
          slot.busy = false;
          for (const [id, p] of this.pending) p.resolve({ id, ok: false, error: 'worker failed', fatal: false, decodeFailed: true });
          this.pending.clear();
          for (const q of this.queue.splice(0)) q.done.resolve({ id: 0, ok: false, error: 'worker failed', fatal: false, decodeFailed: true });
        };
        this.workers.push(slot);
      } catch {
        this.broken = true;
      }
    }
    if (this.workers.length === 0) this.broken = true;
  }

  run(blob: Blob, opts: ImageJobOptions): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      this.queue.push({ req: { blob, opts }, done: { resolve } });
      this.pump();
    });
  }

  private pump() {
    for (const slot of this.workers) {
      if (slot.busy || this.queue.length === 0) continue;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      slot.busy = true;
      this.pending.set(id, job.done);
      slot.worker.postMessage({ id, ...job.req } satisfies WorkerRequest);
    }
  }

  terminate() {
    for (const s of this.workers) s.worker.terminate();
    this.workers = [];
  }
}

let pool: ImageWorkerPool | null = null;

function getPool(): ImageWorkerPool | null {
  if (!workerCapable()) return null;
  if (!pool || pool.broken) {
    if (pool?.broken) return null;
    const size = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
    pool = new ImageWorkerPool(size);
  }
  return pool.broken ? null : pool;
}

async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const mainCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Decode on the main thread: ImageBitmap first, then <img> (covers HEIC in Safari). */
export async function decodeOnMain(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await decodeBitmap(file);
  } catch {
    try {
      return await loadImageElement(file);
    } catch {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const kind = sniffType(head);
      if (kind === 'heic') {
        throw new Error('HEIC/HEIF images can’t be decoded by this browser. Safari on iPhone/Mac can open them; elsewhere, export as JPEG first (on iPhone: Settings → Camera → Formats → Most Compatible).');
      }
      if (kind === 'avif') throw new Error('This browser can’t decode AVIF images.');
      throw new Error('This file couldn’t be decoded as an image (unsupported format or damaged file).');
    }
  }
}

async function runOnMain(file: Blob, opts: ImageJobOptions): Promise<ImageJobResult> {
  const img = await decodeOnMain(file);
  try {
    return await processDrawable(img, opts, mainCanvas);
  } finally {
    if ('close' in img) img.close();
  }
}

export async function processImage(file: Blob, opts: ImageJobOptions): Promise<ImageJobResult> {
  const p = getPool();
  if (p) {
    const res = await p.run(file, opts);
    if (res.ok) return res;
    if (res.fatal) throw new UnsupportedOutputError(res.error);
    // Decoding failed in the worker (e.g. HEIC in Safari only decodes via <img>) — try main thread.
    if (!res.decodeFailed) throw new Error(res.error);
  }
  return runOnMain(file, opts);
}
