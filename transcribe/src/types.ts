/** Data model. Times are seconds (floating point) from the start of the audio. */

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  /** Word timings, when transcribed with word timestamps. Dropped when the segment text is edited. */
  words?: Word[];
}

export type Task = 'transcribe' | 'translate';
export type TimestampMode = 'segment' | 'word';
export type Backend = 'webgpu' | 'wasm';
export type BackendChoice = 'auto' | Backend;
export type SourceKind = 'file' | 'mic' | 'dictation' | 'import';

export interface TranscriptMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Audio length in seconds (0 when unknown). */
  duration: number;
  source: SourceKind;
  fileName?: string;
  /** Model id (e.g. Xenova/whisper-tiny), or "web-speech" for live dictation. */
  model: string;
  backend?: Backend;
  task: Task;
  /** ISO code chosen or detected; undefined when unknown. */
  language?: string;
  languageDetected?: boolean;
  timestamps: TimestampMode;
  /** True when the transcription was cancelled before the end. */
  partial?: boolean;
  /** Audio stored alongside (IndexedDB `audio` store). */
  hasAudio: boolean;
  audioType?: string;
  audioBytes?: number;
  segmentCount: number;
  wordCount: number;
}

export interface Transcript extends TranscriptMeta {
  version: 1;
  segments: Segment[];
}
