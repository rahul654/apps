/**
 * IndexedDB storage for recordings.
 *
 * A recording is a metadata row plus an ordered list of chunk Blobs (one per MediaRecorder
 * timeslice). Chunks are appended as they arrive, so a crash or closed tab loses at most
 * the last second. The playable file is `new Blob(chunks)`. Browsers back IDB Blobs with
 * disk, so assembling it doesn't load the recording into memory.
 *
 * Stores (DB "recorder", v2):
 *   recordings  key: id                 → RecordingMeta
 *   chunks      key: [recId, seq]       → { recId, seq, data: Blob, atMs }
 *   thumbs      key: id                 → { id, data: Blob }  (recordings and screenshots)
 *   shots       key: id                 → ScreenshotMeta       (v2, see screenshotStore.ts)
 *   shotImages  key: id                 → { id, data: Blob }   (v2, the original capture)
 */
import { done, req } from './idb';

export type RecordMode = 'screen-camera' | 'screen' | 'camera' | 'audio';

export interface RecordingMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Recorded (unpaused) duration. */
  durationMs: number;
  size: number;
  mimeType: string;
  mode: RecordMode | 'edit';
  width?: number;
  height?: number;
  status: 'recording' | 'complete';
  chunkCount: number;
  hasThumb: boolean;
  /** For trimmed / converted copies: the recording they came from. */
  sourceId?: string;
}

interface ChunkRow {
  recId: string;
  seq: number;
  data: Blob;
  /** Recorded time (ms, excluding pauses) when the chunk arrived. */
  atMs: number;
}

const DB_NAME = 'recorder';
export const DB_VERSION = 2;

/**
 * Opens (and upgrades) the database. Each step only adds stores, so it runs inside the
 * versionchange transaction and existing data is left alone. v1 → v2 adds the screenshot stores.
 */
export function openRecorderDb(factory: IDBFactory = indexedDB, name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, version);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      if (e.oldVersion < 1) {
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
        if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'id' });
      }
      if (e.oldVersion < 2 && version >= 2) {
        if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('shotImages')) db.createObjectStore('shotImages', { keyPath: 'id' });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('The recordings database is open in an older tab. Close other Recorder tabs and reload.'));
  });
}

const chunkRange = (id: string) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

export class RecordingStore {
  private db: Promise<IDBDatabase>;
  constructor(db: Promise<IDBDatabase>) {
    this.db = db;
  }

  async create(meta: RecordingMeta): Promise<void> {
    const db = await this.db;
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').add(meta);
    await done(tx);
  }

  /** Appends a chunk and updates size / duration in the same transaction. */
  async appendChunk(id: string, seq: number, data: Blob, atMs: number): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
    const recs = tx.objectStore('recordings');
    tx.objectStore('chunks').put({ recId: id, seq, data, atMs } satisfies ChunkRow);
    const meta = (await req(recs.get(id))) as RecordingMeta | undefined;
    if (meta) {
      meta.size += data.size;
      meta.chunkCount += 1;
      meta.durationMs = Math.max(meta.durationMs, atMs);
      meta.updatedAt = Date.now();
      recs.put(meta);
    }
    await done(tx);
  }

  async get(id: string): Promise<RecordingMeta | undefined> {
    const db = await this.db;
    return (await req(db.transaction('recordings').objectStore('recordings').get(id))) as RecordingMeta | undefined;
  }

  async list(): Promise<RecordingMeta[]> {
    const db = await this.db;
    return (await req(db.transaction('recordings').objectStore('recordings').getAll())) as RecordingMeta[];
  }

  async update(id: string, patch: Partial<Omit<RecordingMeta, 'id'>>): Promise<RecordingMeta | undefined> {
    const db = await this.db;
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const meta = (await req(store.get(id))) as RecordingMeta | undefined;
    let next: RecordingMeta | undefined;
    if (meta) {
      next = { ...meta, ...patch, id, updatedAt: Date.now() };
      store.put(next);
    }
    await done(tx);
    return next;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.update(id, { title: title.trim() || 'Untitled recording' });
  }

  private async chunkRows(id: string): Promise<ChunkRow[]> {
    const db = await this.db;
    return (await req(db.transaction('chunks').objectStore('chunks').getAll(chunkRange(id)))) as ChunkRow[];
  }

  /** The playable file (chunks in order). */
  async getBlob(id: string): Promise<Blob> {
    const meta = await this.get(id);
    const rows = await this.chunkRows(id);
    rows.sort((a, b) => a.seq - b.seq);
    return new Blob(rows.map((r) => r.data), { type: meta?.mimeType ?? rows[0]?.data.type ?? '' });
  }

  /** Last chunk timestamp: the recorded duration for an interrupted recording. */
  async lastChunkTime(id: string): Promise<number> {
    const rows = await this.chunkRows(id);
    return rows.reduce((m, r) => Math.max(m, r.atMs), 0);
  }

  /**
   * Replaces the first bytes of the file. `patch` gets the head of the file and returns the
   * replacement for its first `consumed` bytes (or null to leave the file alone). Only the
   * chunks that overlap the head are rewritten.
   */
  async patchHead(id: string, headBytes: number, patch: (head: Uint8Array) => { bytes: Uint8Array; consumed: number } | null): Promise<boolean> {
    const rows = (await this.chunkRows(id)).sort((a, b) => a.seq - b.seq);
    if (rows.length === 0) return false;
    const covering: ChunkRow[] = [];
    let covered = 0;
    for (const r of rows) {
      covering.push(r);
      covered += r.data.size;
      if (covered >= headBytes) break;
    }
    const merged = new Blob(covering.map((r) => r.data));
    const head = new Uint8Array(await merged.slice(0, Math.min(headBytes, merged.size)).arrayBuffer());
    const result = patch(head);
    if (!result || result.consumed > merged.size) return false;
    const type = rows[0].data.type;
    const replacement = new Blob([result.bytes as Uint8Array<ArrayBuffer>, merged.slice(result.consumed)], { type });
    const sizeDelta = replacement.size - merged.size;

    const db = await this.db;
    const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
    const chunks = tx.objectStore('chunks');
    for (const r of covering.slice(1)) chunks.delete([id, r.seq]);
    chunks.put({ ...covering[0], data: replacement, atMs: covering[covering.length - 1].atMs } satisfies ChunkRow);
    const recs = tx.objectStore('recordings');
    const meta = (await req(recs.get(id))) as RecordingMeta | undefined;
    if (meta) {
      meta.size += sizeDelta;
      meta.chunkCount -= covering.length - 1;
      recs.put(meta);
    }
    await done(tx);
    return true;
  }

  /** Stores a finished file (e.g. a trimmed copy) as a single-chunk recording. */
  async saveFile(meta: Omit<RecordingMeta, 'size' | 'chunkCount' | 'status' | 'hasThumb' | 'updatedAt'>, blob: Blob): Promise<RecordingMeta> {
    const full: RecordingMeta = { ...meta, size: blob.size, chunkCount: 1, status: 'complete', hasThumb: false, updatedAt: Date.now() };
    const db = await this.db;
    const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
    tx.objectStore('recordings').put(full);
    tx.objectStore('chunks').put({ recId: meta.id, seq: 0, data: blob, atMs: meta.durationMs } satisfies ChunkRow);
    await done(tx);
    return full;
  }

  async setThumbnail(id: string, data: Blob): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['thumbs', 'recordings'], 'readwrite');
    tx.objectStore('thumbs').put({ id, data });
    const recs = tx.objectStore('recordings');
    const meta = (await req(recs.get(id))) as RecordingMeta | undefined;
    if (meta) recs.put({ ...meta, hasThumb: true });
    await done(tx);
  }

  async getThumbnail(id: string): Promise<Blob | null> {
    const db = await this.db;
    const row = (await req(db.transaction('thumbs').objectStore('thumbs').get(id))) as { data: Blob } | undefined;
    return row?.data ?? null;
  }

  async delete(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['recordings', 'chunks', 'thumbs'], 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.objectStore('chunks').delete(chunkRange(id));
    tx.objectStore('thumbs').delete(id);
    await done(tx);
  }
}

/**
 * Recordings left in the "recording" state by a crash or closed tab.
 * Skips ones another tab is still writing: either it holds the Web Lock for the id, or
 * (when Web Locks aren't available) it wrote a chunk within `staleMs`.
 */
export function findRecoverable(
  metas: RecordingMeta[],
  opts: { now: number; staleMs?: number; activeIds?: ReadonlySet<string> | null },
): RecordingMeta[] {
  const stale = opts.staleMs ?? 15_000;
  return metas
    .filter((m) => m.status === 'recording')
    .filter((m) => (opts.activeIds ? !opts.activeIds.has(m.id) : opts.now - m.updatedAt > stale))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const lockName = (id: string) => `recorder:rec:${id}`;

/** Ids whose recording lock is currently held (null when Web Locks are unsupported). */
export async function heldRecordingIds(): Promise<Set<string> | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.query) return null;
  try {
    const snap = await locks.query();
    const ids = new Set<string>();
    for (const l of [...(snap.held ?? []), ...(snap.pending ?? [])]) {
      if (l.name?.startsWith('recorder:rec:')) ids.add(l.name.slice('recorder:rec:'.length));
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * Turns an interrupted recording into a normal one: duration from the last chunk, header
 * patched by `fixHead` (e.g. the WebM duration patch), status complete.
 */
export async function recoverRecording(
  store: RecordingStore,
  id: string,
  fixHead?: (head: Uint8Array, durationMs: number) => { bytes: Uint8Array; consumed: number } | null,
  headBytes = 64 * 1024,
): Promise<RecordingMeta | undefined> {
  const meta = await store.get(id);
  if (!meta) return undefined;
  if (meta.chunkCount === 0) {
    await store.delete(id);
    return undefined;
  }
  const durationMs = Math.max(meta.durationMs, await store.lastChunkTime(id));
  if (fixHead && durationMs > 0) await store.patchHead(id, headBytes, (head) => fixHead(head, durationMs));
  return store.update(id, { status: 'complete', durationMs, title: meta.title.endsWith('(recovered)') ? meta.title : `${meta.title} (recovered)` });
}

let sharedDb: Promise<IDBDatabase> | null = null;
/** The app-wide connection to the real IndexedDB (shared by recordings and screenshots). */
export function recorderDb(): Promise<IDBDatabase> {
  if (!sharedDb) sharedDb = openRecorderDb();
  return sharedDb;
}

let shared: RecordingStore | null = null;
/** App-wide store on the real IndexedDB. */
export function recordingStore(): RecordingStore {
  if (!shared) shared = new RecordingStore(recorderDb());
  return shared;
}
