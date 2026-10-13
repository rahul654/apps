/**
 * tesseract.js worker pool (browser). Workers, WASM cores and bundled language data are
 * self-hosted (see vite.config.ts); remote language data comes from jsDelivr only when picked.
 */
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { BUNDLED_DIR, ensureLanguageData, assetsFor } from './cache';
import { FAST_REMOTE_BASE, langString, type LangAsset, type OcrModel } from './langs';
import { fromTesseract, type OcrPage } from './result';

export type PageSegMode = 'auto' | 'block' | 'line' | 'sparse';

const PSM_MAP: Record<PageSegMode, PSM> = { auto: PSM.AUTO, block: PSM.SINGLE_BLOCK, line: PSM.SINGLE_LINE, sparse: PSM.SPARSE_TEXT };

export const PSM_LABEL: Record<PageSegMode, string> = {
  auto: 'Automatic (pages, columns)',
  block: 'Single block of text',
  line: 'Single line',
  sparse: 'Sparse text (labels, signs)',
};

export function defaultPoolSize(): number {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(n - 1, 3));
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

interface Slot {
  worker: Worker;
  busy: boolean;
  onProgress?: (p: number) => void;
}

interface Job {
  image: Blob;
  width: number;
  height: number;
  onProgress?: (p: number) => void;
  resolve: (r: OcrPage) => void;
  reject: (e: unknown) => void;
}

function assetBase(): string {
  return new URL(`./${__OCR_ASSET_DIR__}/`, document.baseURI).href;
}

/**
 * If IndexedDB is unavailable (some private modes), workers can still fetch data
 * themselves when all languages come from one directory with the same compression.
 */
function directLangPath(assets: LangAsset[]): { langPath: string; gzip: boolean } | null {
  if (assets.every((a) => a.source === 'bundled')) return { langPath: new URL(`${BUNDLED_DIR}/`, document.baseURI).href, gzip: true };
  if (assets.every((a) => a.model === 'fast' && a.source === 'remote')) return { langPath: FAST_REMOTE_BASE, gzip: false };
  if (assets.length === 1 && assets[0].model === 'best') return { langPath: assets[0].url.replace(/\/[^/]+$/, ''), gzip: true };
  return null;
}

export interface PoolOptions {
  codes: string[];
  model: OcrModel;
  psm: PageSegMode;
  size?: number;
  onStatus?: (label: string, fraction?: number) => void;
  signal?: AbortSignal;
}

export class OcrPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private active = new Set<Job>();
  private dead = false;

  static async create(opts: PoolOptions): Promise<OcrPool> {
    const pool = new OcrPool();
    const assets = assetsFor(opts.codes, opts.model);
    let direct: { langPath: string; gzip: boolean } | null = null;
    try {
      await ensureLanguageData(assets, (f, label) => opts.onStatus?.(label, f), opts.signal);
    } catch (e) {
      direct = /can’t be stored/.test(String((e as Error)?.message)) ? directLangPath(assets) : null;
      if (!direct) throw e;
    }
    if (opts.signal?.aborted) throw new CancelledError();
    const base = assetBase();
    const size = Math.max(1, opts.size ?? defaultPoolSize());
    opts.onStatus?.(`Starting ${size} OCR worker${size > 1 ? 's' : ''}…`);
    const langs = langString(opts.codes);
    const make = async () => {
      const slot: Slot = { worker: null as unknown as Worker, busy: false };
      slot.worker = await createWorker(langs, OEM.LSTM_ONLY, {
        // Wrapper filters benign Tesseract stderr, then loads worker.min.js (see stderr.ts).
        workerPath: `${base}worker-wrapper.js`,
        corePath: base,
        workerBlobURL: false,
        cachePath: opts.model,
        cacheMethod: direct ? 'none' : 'readOnly',
        langPath: direct?.langPath ?? `${base}no-network-language-data`,
        gzip: direct?.gzip ?? true,
        logger: (m) => {
          if (m.status === 'recognizing text') slot.onProgress?.(m.progress);
        },
        errorHandler: () => undefined,
      });
      await slot.worker.setParameters({ tessedit_pageseg_mode: PSM_MAP[opts.psm], preserve_interword_spaces: '1' });
      return slot;
    };
    try {
      pool.slots = await Promise.all(Array.from({ length: size }, make));
    } catch (e) {
      await pool.terminate();
      throw new Error(`The OCR engine couldn’t start: ${String((e as Error)?.message ?? e)}`);
    }
    if (opts.signal?.aborted) {
      await pool.terminate();
      throw new CancelledError();
    }
    return pool;
  }

  get size(): number {
    return this.slots.length;
  }

  recognize(image: Blob, width: number, height: number, onProgress?: (p: number) => void): Promise<OcrPage> {
    if (this.dead) return Promise.reject(new CancelledError());
    return new Promise((resolve, reject) => {
      this.queue.push({ image, width, height, onProgress, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy || !this.queue.length || this.dead) continue;
      const job = this.queue.shift()!;
      slot.busy = true;
      slot.onProgress = job.onProgress;
      this.active.add(job);
      slot.worker
        .recognize(job.image, {}, { text: true, blocks: true })
        .then(({ data }) => job.resolve(fromTesseract(data as never, job.width, job.height)))
        .catch((e) => job.reject(this.dead ? new CancelledError() : e))
        .finally(() => {
          slot.busy = false;
          slot.onProgress = undefined;
          this.active.delete(job);
          this.pump();
        });
    }
  }

  /** Stop everything now (Cancel / leaving the tool). Pending jobs reject with CancelledError. */
  async terminate(): Promise<void> {
    if (this.dead) return;
    this.dead = true;
    for (const j of [...this.queue, ...this.active]) j.reject(new CancelledError());
    this.queue = [];
    await Promise.all(this.slots.map((s) => s.worker.terminate().catch(() => undefined)));
    this.slots = [];
  }
}

export function isCancelled(e: unknown): boolean {
  return e instanceof CancelledError || (e as Error)?.name === 'CancelledError' || (e as DOMException)?.name === 'AbortError';
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t encode the image.'))), 'image/png'));
}
