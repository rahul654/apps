/**
 * Page side of the Whisper worker. One worker is kept between runs so the model stays loaded.
 * Cancelling terminates it (inference can't be interrupted from outside); the next run starts
 * a fresh worker, which reloads the model from Cache Storage.
 */
import type { FromWorker, LoadOptions, ToWorker, TranscribeOptions } from '../workers/protocol';

export function ortBase(): string {
  return new URL(`./${__ORT_DIR__}/`, document.baseURI).href;
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

type Done = Extract<FromWorker, { type: 'done' }>;

export class WhisperClient {
  private worker: Worker | null = null;
  private onMessage: ((m: FromWorker) => void) | null = null;
  private pending: { resolve: (v: Done | null) => void; reject: (e: unknown) => void; until: 'done' | 'ready' } | null = null;

  private get(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module', name: 'whisper' });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      this.onMessage?.(m);
      const p = this.pending;
      if (!p) return;
      if (m.type === 'error') {
        this.pending = null;
        p.reject(new Error(m.message));
      } else if (m.type === 'done' && p.until === 'done') {
        this.pending = null;
        p.resolve(m);
      } else if (m.type === 'status' && m.phase === 'ready' && p.until === 'ready') {
        this.pending = null;
        p.resolve(null);
      } else if (m.type === 'backend' && p.until === 'ready') {
        // Already loaded: the worker reports the backend without a new "ready".
        this.pending = null;
        p.resolve(null);
      }
    };
    w.onerror = (e) => {
      const p = this.pending;
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
      p?.reject(new Error(e.message || 'The transcription worker crashed (possibly out of memory). Try a smaller model or a shorter file.'));
    };
    this.worker = w;
    return w;
  }

  private send(msg: ToWorker, until: 'done' | 'ready', onMessage: (m: FromWorker) => void, transfer: Transferable[] = []): Promise<Done | null> {
    if (this.pending) this.cancel();
    this.onMessage = onMessage;
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, until };
      this.get().postMessage(msg, transfer);
    });
  }

  /** Downloads (if needed) and initialises a model. */
  async load(opts: LoadOptions, onMessage: (m: FromWorker) => void): Promise<void> {
    await this.send({ type: 'load', ...opts }, 'ready', onMessage);
  }

  /** Transcribes 16 kHz mono samples. The array is copied, so the caller keeps its own. */
  async transcribe(audio: Float32Array, opts: TranscribeOptions, onMessage: (m: FromWorker) => void): Promise<Done> {
    const copy = audio.slice();
    const done = await this.send({ type: 'transcribe', audio: copy, ...opts }, 'done', onMessage, [copy.buffer]);
    return done!;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  cancel(): void {
    const p = this.pending;
    this.pending = null;
    this.onMessage = null;
    this.worker?.terminate();
    this.worker = null;
    p?.reject(new CancelledError());
  }

  dispose(): void {
    this.cancel();
  }
}

export const whisper = new WhisperClient();
