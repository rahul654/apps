/**
 * One recording: MediaRecorder with a 1 s timeslice, every chunk appended to IndexedDB as it
 * arrives (nothing accumulates in memory). On stop: wait for the last chunk, patch the WebM
 * duration into the header, mark the recording complete.
 *
 * Holds a Web Lock named after the recording while it runs, so another tab's crash-recovery
 * check doesn't treat a live recording as abandoned.
 */
import { defaultTitle } from '../lib/format';
import type { FormatChoice } from '../lib/mime';
import { lockName, type RecordingMeta, type RecordingStore, type RecordMode } from '../lib/recordingStore';
import { HEAD_BYTES, isWebm, patchWebmHead } from '../lib/webmDuration';

export const TIMESLICE_MS = 1000;

export interface SessionOptions {
  stream: MediaStream;
  format: FormatChoice | null;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  store: RecordingStore;
  mode: RecordMode;
  width?: number;
  height?: number;
  onError: (e: unknown) => void;
  /** Chunk persisted (bytes so far). */
  onProgress?: (bytes: number) => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class RecordingSession {
  readonly id = newId();
  private rec: MediaRecorder;
  private store: RecordingStore;
  private opts: SessionOptions;
  private seq = 0;
  private bytes = 0;
  private writes: Promise<void> = Promise.resolve();
  private writeError: unknown = null;
  private runningSince: number | null = null;
  private accumulated = 0;
  private releaseLock: (() => void) | null = null;
  private stopped: Promise<void> | null = null;
  private discarded = false;
  readonly mimeType: string;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.store = opts.store;
    const options: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number } = {
      ...(opts.format ? { mimeType: opts.format.mimeType } : {}),
      ...(opts.videoBitsPerSecond ? { videoBitsPerSecond: opts.videoBitsPerSecond } : {}),
      ...(opts.audioBitsPerSecond ? { audioBitsPerSecond: opts.audioBitsPerSecond } : {}),
      // Chromium 116+: a key frame every 2 s makes seeking and fast (no re-encode) trims precise.
      videoKeyFrameIntervalDuration: 2000,
    };
    try {
      this.rec = new MediaRecorder(opts.stream, options);
    } catch {
      // Unsupported option combination: let the browser choose.
      this.rec = new MediaRecorder(opts.stream);
    }
    this.mimeType = this.rec.mimeType || opts.format?.mimeType || (opts.stream.getVideoTracks().length ? 'video/webm' : 'audio/webm');
    this.rec.ondataavailable = (e) => this.onData(e.data);
    this.rec.onerror = (e) => opts.onError((e as unknown as { error?: unknown }).error ?? new Error('MediaRecorder error'));
  }

  /** Recorded time excluding pauses. */
  elapsed(now = performance.now()): number {
    return this.accumulated + (this.runningSince !== null ? now - this.runningSince : 0);
  }

  get state(): RecordingState {
    return this.rec.state;
  }

  async start(): Promise<void> {
    const meta: RecordingMeta = {
      id: this.id,
      title: defaultTitle(new Date()),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      durationMs: 0,
      size: 0,
      mimeType: this.mimeType,
      mode: this.opts.mode,
      width: this.opts.width,
      height: this.opts.height,
      status: 'recording',
      chunkCount: 0,
      hasThumb: false,
    };
    await this.store.create(meta);
    this.acquireLock();
    this.rec.start(TIMESLICE_MS);
    this.runningSince = performance.now();
  }

  private acquireLock() {
    const locks = navigator.locks;
    if (!locks?.request) return;
    void locks
      .request(lockName(this.id), () => new Promise<void>((resolve) => {
        this.releaseLock = resolve;
      }))
      .catch(() => {});
  }

  private onData(data: Blob) {
    if (!data || data.size === 0 || this.discarded) return;
    const seq = this.seq++;
    const at = Math.round(this.elapsed());
    this.bytes += data.size;
    this.writes = this.writes.then(async () => {
      if (this.discarded) return;
      try {
        await this.store.appendChunk(this.id, seq, data, at);
        this.opts.onProgress?.(this.bytes);
      } catch (e) {
        // Quota exceeded or similar: stop rather than silently losing data.
        if (!this.writeError) {
          this.writeError = e;
          this.opts.onError(e);
        }
      }
    });
  }

  get size(): number {
    return this.bytes;
  }

  pause(): void {
    if (this.rec.state !== 'recording') return;
    this.rec.pause();
    if (this.runningSince !== null) this.accumulated += performance.now() - this.runningSince;
    this.runningSince = null;
  }

  resume(): void {
    if (this.rec.state !== 'paused') return;
    this.rec.resume();
    this.runningSince = performance.now();
  }

  private stopRecorder(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.stopped = new Promise<void>((resolve) => {
      if (this.rec.state === 'inactive') {
        resolve();
        return;
      }
      this.rec.addEventListener('stop', () => resolve(), { once: true });
      try {
        this.rec.stop();
      } catch {
        resolve();
      }
    });
    if (this.runningSince !== null) this.accumulated += performance.now() - this.runningSince;
    this.runningSince = null;
    return this.stopped;
  }

  /** Stops, flushes, patches the header and marks the recording complete. */
  async finish(): Promise<RecordingMeta> {
    await this.stopRecorder();
    await this.writes;
    const durationMs = Math.round(this.accumulated);
    try {
      if (isWebm(this.mimeType) && durationMs > 0) {
        await this.store.patchHead(this.id, HEAD_BYTES, (head) => patchWebmHead(head, durationMs));
      }
    } catch (e) {
      console.warn('[recorder] WebM duration patch failed; file is still playable', e);
    }
    const meta = await this.store.update(this.id, { status: 'complete', durationMs });
    this.releaseLock?.();
    if (!meta) throw new Error('The recording could not be saved.');
    return meta;
  }

  /** Stops and deletes everything written so far. */
  async discard(): Promise<void> {
    this.discarded = true;
    await this.stopRecorder();
    await this.writes;
    await this.store.delete(this.id).catch(() => {});
    this.releaseLock?.();
  }
}
