/**
 * Transcript library in IndexedDB. Nothing leaves the browser.
 *
 * DB "transcribe" (v1), namespaced because every app on the GitHub Pages origin shares IndexedDB:
 *   transcripts  key: id → Transcript (metadata + segments)
 *   audio        key: id → { id, blob }   (the audio the transcript was made from, if kept)
 *
 * Records are validated on read (`parseTranscript`), so a damaged or older record is skipped
 * rather than crashing the page. The same validation is used for JSON imports.
 */
import type { Backend, Segment, SourceKind, Task, TimestampMode, Transcript, TranscriptMeta, Word } from '../types';

export const DB_NAME = 'transcribe';
const DB_VERSION = 1;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

function parseWords(v: unknown): Word[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const words: Word[] = [];
  for (const w of v) {
    if (!w || typeof w !== 'object') return undefined;
    const { text, start, end } = w as Record<string, unknown>;
    if (!str(text) || !num(start) || !num(end) || start < 0) return undefined;
    words.push({ text, start, end: Math.max(start, end) });
  }
  return words;
}

/** Valid segments only; times must be finite and non-negative. Segments are sorted by start. */
export function parseSegments(v: unknown): Segment[] | null {
  if (!Array.isArray(v)) return null;
  const out: Segment[] = [];
  const ids = new Set<string>();
  v.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    if (!str(r.text) || !num(r.start) || !num(r.end) || r.start < 0) return;
    let id = str(r.id) && r.id ? r.id : `s${i}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const words = parseWords(r.words);
    out.push({ id, start: r.start, end: Math.max(r.start, r.end), text: r.text, ...(words ? { words } : {}) });
  });
  return out.sort((a, b) => a.start - b.start);
}

export function countWords(segments: Segment[]): number {
  return segments.reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0);
}

/**
 * Validates a stored or imported transcript. Returns null if it can't be used.
 * With `defaults`, missing metadata is filled in (imports); without, id and title are required.
 */
export function parseTranscript(v: unknown, defaults?: Partial<Transcript>): Transcript | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const segments = parseSegments(r.segments);
  if (!segments) return null;
  const id = str(r.id) && r.id ? r.id : defaults?.id;
  const title = str(r.title) ? r.title : defaults?.title;
  if (!id || title === undefined) return null;
  const now = Date.now();
  const createdAt = num(r.createdAt) ? r.createdAt : (defaults?.createdAt ?? now);
  const lastEnd = segments.reduce((m, s) => Math.max(m, s.end), 0);
  return {
    version: 1,
    id,
    title: title.slice(0, 200),
    createdAt,
    updatedAt: num(r.updatedAt) ? r.updatedAt : (defaults?.updatedAt ?? createdAt),
    duration: num(r.duration) && r.duration >= 0 ? r.duration : lastEnd,
    source: oneOf<SourceKind>(r.source, ['file', 'mic', 'dictation', 'import'], defaults?.source ?? 'import'),
    ...(str(r.fileName) ? { fileName: r.fileName } : {}),
    model: str(r.model) ? r.model : (defaults?.model ?? 'unknown'),
    ...(r.backend === 'webgpu' || r.backend === 'wasm' ? { backend: r.backend as Backend } : {}),
    task: oneOf<Task>(r.task, ['transcribe', 'translate'], 'transcribe'),
    ...(str(r.language) ? { language: r.language } : {}),
    ...(r.languageDetected === true ? { languageDetected: true } : {}),
    timestamps: oneOf<TimestampMode>(r.timestamps, ['segment', 'word'], segments.some((s) => s.words) ? 'word' : 'segment'),
    ...(r.partial === true ? { partial: true } : {}),
    hasAudio: defaults?.hasAudio ?? r.hasAudio === true,
    ...(str(r.audioType) ? { audioType: r.audioType } : {}),
    ...(num(r.audioBytes) ? { audioBytes: r.audioBytes } : {}),
    segmentCount: segments.length,
    wordCount: countWords(segments),
    segments,
  };
}

export function metaOf(t: Transcript): TranscriptMeta {
  const { segments, version, ...meta } = t;
  void segments;
  void version;
  return meta;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error);
  });
}

export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('transcripts')) db.createObjectStore('transcripts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('The transcript library is open in an older tab. Close other Speech to Text tabs and reload.'));
  });
}

export class TranscriptStore {
  private db: Promise<IDBDatabase> | null = null;
  private listeners = new Set<() => void>();

  constructor(private factory?: () => IDBFactory, private name = DB_NAME) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const f = this.factory ? this.factory() : indexedDB;
      this.db = openDb(f, this.name).catch((e) => {
        this.db = null;
        throw e;
      });
    }
    return this.db;
  }

  /** Called after any change (this tab). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }

  async list(): Promise<TranscriptMeta[]> {
    const db = await this.open();
    const rows = await req(db.transaction('transcripts').objectStore('transcripts').getAll());
    return rows
      .map((r) => parseTranscript(r))
      .filter((t): t is Transcript => t !== null)
      .map(metaOf)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Transcript | null> {
    const db = await this.open();
    return parseTranscript(await req(db.transaction('transcripts').objectStore('transcripts').get(id)));
  }

  /** Saves the transcript (and its audio, if given) in one transaction. */
  async put(t: Transcript, audio?: Blob): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['transcripts', 'audio'], 'readwrite');
    const rec: Transcript = {
      ...t,
      segmentCount: t.segments.length,
      wordCount: countWords(t.segments),
      ...(audio ? { hasAudio: true, audioType: audio.type, audioBytes: audio.size } : {}),
    };
    tx.objectStore('transcripts').put(rec);
    if (audio) tx.objectStore('audio').put({ id: t.id, blob: audio });
    await done(tx);
    this.changed();
  }

  async getAudio(id: string): Promise<Blob | null> {
    const db = await this.open();
    const row = (await req(db.transaction('audio').objectStore('audio').get(id))) as { blob?: unknown } | undefined;
    return row?.blob instanceof Blob ? row.blob : null;
  }

  async rename(id: string, title: string): Promise<void> {
    const t = await this.get(id);
    if (!t) throw new Error('That transcript no longer exists.');
    await this.put({ ...t, title: title.trim().slice(0, 200) || t.title, updatedAt: Date.now() });
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['transcripts', 'audio'], 'readwrite');
    tx.objectStore('transcripts').delete(id);
    tx.objectStore('audio').delete(id);
    await done(tx);
    this.changed();
  }

  /** Removes the stored audio but keeps the transcript. */
  async removeAudio(id: string): Promise<void> {
    const t = await this.get(id);
    const db = await this.open();
    const tx = db.transaction(['transcripts', 'audio'], 'readwrite');
    tx.objectStore('audio').delete(id);
    if (t) {
      const { audioType, audioBytes, ...rest } = t;
      void audioType;
      void audioBytes;
      tx.objectStore('transcripts').put({ ...rest, hasAudio: false });
    }
    await done(tx);
    this.changed();
  }
}

export const transcriptStore = new TranscriptStore();
