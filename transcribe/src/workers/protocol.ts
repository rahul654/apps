/** Messages between the page and the Whisper worker. */
import type { Backend, BackendChoice, Segment, Task, TimestampMode } from '../types';

export interface LoadOptions {
  model: string;
  backend: BackendChoice;
  /** Absolute URL of the folder holding the self-hosted ONNX Runtime WASM files. */
  ortBase: string;
}

export interface TranscribeOptions extends LoadOptions {
  /** '' = detect from the audio. */
  language: string;
  task: Task;
  timestamps: TimestampMode;
  /** Log each window's raw Whisper output to the console (`?debug=1`). */
  debug?: boolean;
}

export type ToWorker =
  | ({ type: 'load' } & LoadOptions)
  | ({ type: 'transcribe'; audio: Float32Array } & TranscribeOptions);

export interface FileProgress {
  file: string;
  loaded: number;
  total: number;
  cached: boolean;
}

export type FromWorker =
  | { type: 'backend'; backend: Backend; fallbackReason?: string }
  | { type: 'download'; files: FileProgress[] }
  | { type: 'status'; phase: 'loading' | 'ready' | 'detecting' | 'transcribing'; message: string }
  | { type: 'language'; code: string; probability: number }
  /** Text decoded so far in the current window (streaming). */
  | { type: 'partial'; window: number; text: string }
  /** A window finished. `segments` is the whole merged transcript so far. */
  | { type: 'progress'; done: number; total: number; segments: Segment[] }
  | { type: 'done'; segments: Segment[]; language?: string; languageDetected: boolean; backend: Backend; elapsedMs: number }
  | { type: 'error'; message: string };
