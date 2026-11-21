/**
 * The current transcription job. Lives outside React so a run keeps going (and its progress
 * survives) while you look at the library or another page.
 */
import { useSyncExternalStore } from 'react';
import { WHISPER_RATE, encodeWav } from '../lib/audio';
import { decodeErrorInfo, type ErrorInfo } from '../lib/errors';
import { isDebugMode } from '../lib/fake';
import { newId } from '../lib/id';
import { countWords, transcriptStore } from '../lib/storage';
import type { Prefs } from '../lib/prefs';
import { decodeForWhisper } from '../media/decode';
import { CancelledError, ortBase, whisper } from '../media/whisperClient';
import type { Backend, Segment, SourceKind, Transcript } from '../types';
import type { FileProgress, FromWorker } from '../workers/protocol';

export type JobStatus = 'idle' | 'decoding' | 'ready' | 'running' | 'done' | 'cancelled' | 'error';

export interface JobInput {
  source: SourceKind;
  title: string;
  fileName?: string;
  blob: Blob;
  samples: Float32Array;
  duration: number;
}

export interface JobState {
  status: JobStatus;
  input: JobInput | null;
  phase: 'loading' | 'detecting' | 'transcribing' | null;
  message: string;
  files: FileProgress[];
  backend?: Backend;
  fallbackReason?: string;
  language?: { code: string; probability: number };
  windowsDone: number;
  windowsTotal: number;
  partial: string;
  segments: Segment[];
  startedAt: number;
  elapsedMs: number;
  error?: ErrorInfo;
  savedId?: string;
  /** Settings the current/last run used. */
  prefs?: Prefs;
  /** Increments each time a run starts, so pages can tell runs apart. */
  runId: number;
}

const INITIAL: JobState = {
  status: 'idle',
  input: null,
  phase: null,
  message: '',
  files: [],
  windowsDone: 0,
  windowsTotal: 0,
  partial: '',
  segments: [],
  startedAt: 0,
  elapsedMs: 0,
  runId: 0,
};

/** What gets stored as the transcript's audio: audio files as they are; video and recordings as 16 kHz WAV. */
export function audioToKeep(input: Pick<JobInput, 'blob' | 'samples' | 'source'>): Blob {
  if (input.source === 'file' && input.blob.type.startsWith('audio/')) return input.blob;
  return new Blob([encodeWav(input.samples, WHISPER_RATE)], { type: 'audio/wav' });
}

class JobStore {
  private state: JobState = INITIAL;
  private listeners = new Set<() => void>();

  getState = (): JobState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<JobState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    if (this.state.status === 'running') whisper.cancel();
    this.set({ ...INITIAL, runId: this.state.runId });
  }

  /** Decodes a file or recording into 16 kHz mono and makes it the job's input. */
  async setInput(blob: Blob, meta: { source: SourceKind; title: string; fileName?: string }): Promise<void> {
    if (this.state.status === 'running') whisper.cancel();
    this.set({ ...INITIAL, runId: this.state.runId, status: 'decoding', message: 'Reading the audio…' });
    try {
      const { samples, duration } = await decodeForWhisper(blob);
      if (!samples.length) throw Object.assign(new Error('The file has no audio.'), { name: 'EncodingError' });
      this.set({ status: 'ready', message: '', input: { ...meta, blob, samples, duration } });
    } catch (e) {
      this.set({ status: 'error', message: '', error: decodeErrorInfo(e, meta.fileName) });
    }
  }

  /** Accepts already-decoded audio (tests, or callers that decoded themselves). */
  setDecoded(input: JobInput): void {
    this.set({ ...INITIAL, runId: this.state.runId, status: 'ready', input });
  }

  async start(prefs: Prefs): Promise<void> {
    const input = this.state.input;
    if (!input || this.state.status === 'running') return;
    const runId = this.state.runId + 1;
    this.set({
      ...INITIAL,
      input,
      runId,
      status: 'running',
      phase: 'loading',
      message: 'Starting…',
      startedAt: performance.now(),
      prefs,
    });
    const onMessage = (m: FromWorker) => {
      if (this.state.runId !== runId) return;
      const elapsedMs = performance.now() - this.state.startedAt;
      switch (m.type) {
        case 'backend':
          this.set({ backend: m.backend, fallbackReason: m.fallbackReason, elapsedMs });
          break;
        case 'download':
          this.set({ files: m.files, elapsedMs });
          break;
        case 'status':
          if (m.phase !== 'ready') this.set({ phase: m.phase, message: m.message, elapsedMs });
          break;
        case 'language':
          this.set({ language: { code: m.code, probability: m.probability }, elapsedMs });
          break;
        case 'partial':
          this.set({ partial: m.text, elapsedMs });
          break;
        case 'progress':
          this.set({ windowsDone: m.done, windowsTotal: m.total, segments: m.segments, elapsedMs });
          break;
        default:
          break;
      }
    };
    try {
      const done = await whisper.transcribe(
        input.samples,
        { model: prefs.model, backend: prefs.backend, ortBase: ortBase(), language: prefs.language, task: prefs.task, timestamps: prefs.timestamps, debug: isDebugMode() },
        onMessage,
      );
      if (this.state.runId !== runId) return;
      this.set({ segments: done.segments, partial: '', backend: done.backend, elapsedMs: done.elapsedMs, message: 'Saving…' });
      const id = await this.save(false, done.language, done.languageDetected);
      this.set({ status: 'done', phase: null, message: 'Done', savedId: id });
    } catch (e) {
      if (this.state.runId !== runId) return;
      if (e instanceof CancelledError) {
        this.set({ status: 'cancelled', phase: null, partial: '', message: 'Cancelled' });
      } else {
        this.set({ status: 'error', phase: null, partial: '', error: { title: 'Transcription failed', message: (e as Error)?.message ?? String(e), canRetry: true } });
      }
    }
  }

  cancel(): void {
    if (this.state.status === 'running') whisper.cancel();
  }

  /** Saves the current segments to the library and returns the new id. */
  async save(partial: boolean, language = this.state.prefs?.language || this.state.language?.code, languageDetected = !this.state.prefs?.language && !!this.state.language): Promise<string> {
    const { input, prefs, segments, backend } = this.state;
    if (!input || !prefs) throw new Error('Nothing to save.');
    const now = Date.now();
    const t: Transcript = {
      version: 1,
      id: newId(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
      duration: input.duration,
      source: input.source,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      model: prefs.model,
      ...(backend ? { backend } : {}),
      task: prefs.task,
      ...(language ? { language } : {}),
      ...(languageDetected ? { languageDetected: true } : {}),
      timestamps: prefs.timestamps,
      ...(partial ? { partial: true } : {}),
      hasAudio: false,
      segmentCount: segments.length,
      wordCount: countWords(segments),
      segments,
    };
    await transcriptStore.put(t, prefs.keepAudio ? audioToKeep(input) : undefined);
    if (partial) this.set({ savedId: t.id, status: 'done' });
    return t.id;
  }
}

export const jobStore = new JobStore();

export function useJob(): JobState {
  return useSyncExternalStore(jobStore.subscribe, jobStore.getState, jobStore.getState);
}
