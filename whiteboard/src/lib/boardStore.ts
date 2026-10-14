import { makeBackup, type Backup, type BackupBoard } from './backup';
import { openDatabase, request, STORES, transactionDone } from './db';
import { copyTitle, DEFAULT_TITLE, normalizeTitle, uniqueTitle } from './format';
import { newId } from './id';
import { pickAppState, referencedFileIds, SchemaError, validateFiles, validateMeta, validateScene, validateElements } from './schema';
import { validateLibraryItems } from './excalidrawFile';
import {
  SCHEMA_VERSION,
  type BoardMeta,
  type BoardScene,
  type BoardSnapshot,
  type LibraryItem,
  type LoadedBoard,
  type SavedAppState,
  type SceneElement,
  type SceneFile,
  type StoredFile,
  type Thumbnail,
} from './types';

export interface CreateInput {
  title?: string;
  elements?: readonly SceneElement[];
  appState?: SavedAppState;
  files?: readonly SceneFile[];
  template?: string;
}

export interface SaveInput {
  elements: readonly SceneElement[];
  appState: SavedAppState;
  /** Files the scene currently has. Only ids not yet stored are written; unreferenced ones are removed. */
  files: readonly SceneFile[];
}

export interface ListResult {
  boards: BoardMeta[];
  /** Records that failed validation (kept in the database, just not shown). */
  invalid: number;
}

export type ChangeKind = 'list' | 'library';
type Listener = (kind: ChangeKind, boardId?: string) => void;

const LIBRARY_KEY = 'library';

export class BoardNotFoundError extends Error {
  constructor(id: string) {
    super(`Board ${id} not found`);
  }
}

/**
 * Boards live in IndexedDB, split so the library list never reads scene data:
 *   boards  (id)            → BoardMeta summary
 *   scenes  (id)            → elements + appState
 *   files   ([boardId, id]) → image data URLs (index: boardId)
 *   thumbs  (id)            → small PNG data URL
 *   kv      (key)           → Excalidraw library items
 */
export class BoardStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  readonly dbName: string;
  private readonly idb: IDBFactory | undefined;

  constructor(dbName = 'whiteboard', idb?: IDBFactory) {
    this.dbName = dbName;
    this.idb = idb;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(`whiteboard:${dbName}`);
        this.channel.onmessage = (e: MessageEvent<{ kind: ChangeKind; id?: string }>) => this.emit(e.data.kind, e.data.id, false);
      } catch {
        this.channel = null;
      }
    }
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase(this.dbName, this.idb ?? indexedDB).catch((e) => {
      this.dbPromise = null;
      throw e;
    });
    return this.dbPromise;
  }

  /** Subscribe to changes made through this store, or any store on the same DB in another tab. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind, id?: string, broadcast = true) {
    for (const fn of this.listeners) fn(kind, id);
    if (broadcast) this.channel?.postMessage({ kind, id });
  }

  async close(): Promise<void> {
    this.channel?.close();
    this.channel = null;
    if (this.dbPromise) (await this.dbPromise).close();
    this.dbPromise = null;
  }

  // ---------- Reading ----------

  async list(): Promise<ListResult> {
    const db = await this.db();
    const raw = await request(db.transaction(STORES.boards).objectStore(STORES.boards).getAll());
    const boards: BoardMeta[] = [];
    let invalid = 0;
    for (const r of raw) {
      try {
        boards.push(validateMeta(r));
      } catch {
        invalid++;
      }
    }
    return { boards, invalid };
  }

  async thumbnails(): Promise<Map<string, Thumbnail>> {
    const db = await this.db();
    const raw = (await request(db.transaction(STORES.thumbs).objectStore(STORES.thumbs).getAll())) as Thumbnail[];
    return new Map(raw.filter((t) => typeof t?.dataURL === 'string').map((t) => [t.id, t]));
  }

  async get(id: string): Promise<BoardMeta | null> {
    const db = await this.db();
    const raw = await request(db.transaction(STORES.boards).objectStore(STORES.boards).get(id));
    if (!raw) return null;
    try {
      return validateMeta(raw);
    } catch {
      return null;
    }
  }

  /** Loads a board for editing. Returns null if missing; throws SchemaError if unreadable. */
  async load(id: string): Promise<LoadedBoard | null> {
    const db = await this.db();
    const tx = db.transaction([STORES.boards, STORES.scenes, STORES.files]);
    const [rawMeta, rawScene, rawFiles] = await Promise.all([
      request(tx.objectStore(STORES.boards).get(id)),
      request(tx.objectStore(STORES.scenes).get(id)),
      request(tx.objectStore(STORES.files).index('boardId').getAll(id)),
    ]);
    if (!rawMeta) return null;
    const meta = validateMeta(rawMeta);
    const scene = validateScene(rawScene, id);
    return { meta, scene, files: validateFiles(rawFiles) };
  }

  // ---------- Writing ----------

  async create(input: CreateInput = {}, now = Date.now()): Promise<BoardMeta> {
    const { boards } = await this.list();
    const title = uniqueTitle(normalizeTitle(input.title ?? '') || DEFAULT_TITLE, boards.map((b) => b.title));
    const elements = validateElements(input.elements ?? []).elements;
    const meta: BoardMeta = { id: newId('b_'), title, createdAt: now, updatedAt: now, elementCount: elements.length, schemaVersion: SCHEMA_VERSION, revision: 1 };
    if (input.template) meta.template = input.template;
    const scene: BoardScene = { id: meta.id, elements, appState: pickAppState(input.appState ?? {}), schemaVersion: SCHEMA_VERSION };
    const wanted = referencedFileIds(elements);
    const files = validateFiles(input.files ?? []).filter((f) => wanted.has(f.id));
    await this.writeAll({ meta, scene, files, thumbnail: null });
    this.emit('list', meta.id);
    return meta;
  }

  private async writeAll(s: BoardSnapshot): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORES.boards, STORES.scenes, STORES.files, STORES.thumbs], 'readwrite');
    tx.objectStore(STORES.boards).put(s.meta);
    tx.objectStore(STORES.scenes).put(s.scene);
    const fs = tx.objectStore(STORES.files);
    for (const f of s.files) fs.put({ ...f, boardId: s.meta.id } satisfies StoredFile);
    if (s.thumbnail) tx.objectStore(STORES.thumbs).put({ ...s.thumbnail, id: s.meta.id });
    await transactionDone(tx);
  }

  /**
   * Saves the scene. A content save (`touch`, the default) bumps updatedAt and revision;
   * `touch: false` only stores viewport/preferences without counting as an edit.
   */
  async save(id: string, input: SaveInput, now = Date.now(), { touch = true }: { touch?: boolean } = {}): Promise<BoardMeta> {
    const db = await this.db();
    const elements = validateElements(input.elements).elements;
    const wanted = referencedFileIds(elements);
    const tx = db.transaction([STORES.boards, STORES.scenes, STORES.files], 'readwrite');
    const done = transactionDone(tx);
    const boards = tx.objectStore(STORES.boards);
    const filesStore = tx.objectStore(STORES.files);
    let meta: BoardMeta;
    try {
      const raw = await request(boards.get(id));
      if (!raw) throw new BoardNotFoundError(id);
      const prev = validateMeta(raw);
      meta = touch ? { ...prev, updatedAt: Math.max(now, prev.updatedAt), elementCount: elements.length, revision: prev.revision + 1 } : { ...prev, elementCount: elements.length };
      boards.put(meta);
      tx.objectStore(STORES.scenes).put({ id, elements, appState: pickAppState(input.appState), schemaVersion: SCHEMA_VERSION } satisfies BoardScene);
      const storedKeys = (await request(filesStore.index('boardId').getAllKeys(id))) as [string, string][];
      const stored = new Set(storedKeys.map((k) => k[1]));
      for (const f of validateFiles(input.files)) {
        if (wanted.has(f.id) && !stored.has(f.id)) filesStore.put({ ...f, boardId: id } satisfies StoredFile);
      }
      for (const fileId of stored) if (!wanted.has(fileId)) filesStore.delete([id, fileId]);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      await done.catch(() => undefined);
      throw e;
    }
    await done;
    if (touch) this.emit('list', id);
    return meta;
  }

  async rename(id: string, title: string, now = Date.now()): Promise<BoardMeta> {
    const clean = normalizeTitle(title) || DEFAULT_TITLE;
    return this.updateMeta(id, (m) => (m.title === clean ? m : { ...m, title: clean, updatedAt: Math.max(now, m.updatedAt) }));
  }

  private async updateMeta(id: string, fn: (m: BoardMeta) => BoardMeta): Promise<BoardMeta> {
    const db = await this.db();
    const tx = db.transaction(STORES.boards, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORES.boards);
    const raw = await request(store.get(id));
    if (!raw) {
      await done;
      throw new BoardNotFoundError(id);
    }
    const prev = validateMeta(raw);
    const next = fn(prev);
    if (next !== prev) store.put(next);
    await done;
    if (next !== prev) this.emit('list', id);
    return next;
  }

  async setThumbnail(id: string, dataURL: string, revision: number): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORES.boards, STORES.thumbs], 'readwrite');
    const done = transactionDone(tx);
    // Only store it if the board still exists (it may have been deleted while rendering).
    const exists = await request(tx.objectStore(STORES.boards).getKey(id));
    if (exists !== undefined) tx.objectStore(STORES.thumbs).put({ id, dataURL, revision } satisfies Thumbnail);
    await done;
    if (exists !== undefined) this.emit('list', id);
  }

  async duplicate(id: string, now = Date.now()): Promise<BoardMeta> {
    const src = await this.snapshot(id);
    if (!src) throw new BoardNotFoundError(id);
    const { boards } = await this.list();
    const newMeta: BoardMeta = { ...src.meta, id: newId('b_'), title: copyTitle(src.meta.title, boards.map((b) => b.title)), createdAt: now, updatedAt: now };
    await this.writeAll({
      meta: newMeta,
      scene: { ...src.scene, id: newMeta.id },
      files: src.files,
      thumbnail: src.thumbnail ? { ...src.thumbnail, id: newMeta.id } : null,
    });
    this.emit('list', newMeta.id);
    return newMeta;
  }

  /** Everything stored for a board, for undo and backups. */
  async snapshot(id: string): Promise<BoardSnapshot | null> {
    const loaded = await this.load(id);
    if (!loaded) return null;
    const db = await this.db();
    const thumb = (await request(db.transaction(STORES.thumbs).objectStore(STORES.thumbs).get(id))) as Thumbnail | undefined;
    return { ...loaded, thumbnail: thumb ?? null };
  }

  /** Deletes a board and returns what was removed, so it can be restored (undo). */
  async remove(id: string): Promise<BoardSnapshot | null> {
    const snap = await this.snapshot(id);
    const db = await this.db();
    const tx = db.transaction([STORES.boards, STORES.scenes, STORES.files, STORES.thumbs], 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORES.boards).delete(id);
    tx.objectStore(STORES.scenes).delete(id);
    tx.objectStore(STORES.thumbs).delete(id);
    const fs = tx.objectStore(STORES.files);
    const keys = await request(fs.index('boardId').getAllKeys(id));
    for (const k of keys) fs.delete(k);
    await done;
    this.emit('list', id);
    return snap;
  }

  async restore(snapshot: BoardSnapshot): Promise<void> {
    await this.writeAll(snapshot);
    this.emit('list', snapshot.meta.id);
  }

  // ---------- Excalidraw library ----------

  async getLibrary(): Promise<LibraryItem[]> {
    const db = await this.db();
    const rec = (await request(db.transaction(STORES.kv).objectStore(STORES.kv).get(LIBRARY_KEY))) as { items?: unknown } | undefined;
    return validateLibraryItems(rec?.items);
  }

  async setLibrary(items: readonly unknown[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORES.kv, 'readwrite');
    tx.objectStore(STORES.kv).put({ key: LIBRARY_KEY, items: validateLibraryItems(items) });
    await transactionDone(tx);
    this.emit('library');
  }

  /** Adds items whose ids aren't in the library yet. Returns how many were added. */
  async addToLibrary(items: readonly LibraryItem[]): Promise<number> {
    const current = await this.getLibrary();
    const ids = new Set(current.map((i) => i.id));
    const fresh = items.filter((i) => !ids.has(i.id));
    if (fresh.length) await this.setLibrary([...fresh, ...current]);
    return fresh.length;
  }

  // ---------- Backup ----------

  async exportAll(now = new Date()): Promise<Backup> {
    const { boards } = await this.list();
    const out: BackupBoard[] = [];
    for (const meta of boards) {
      const loaded = await this.load(meta.id).catch(() => null);
      if (loaded) out.push({ meta: loaded.meta, scene: loaded.scene, files: loaded.files });
    }
    return makeBackup(out, await this.getLibrary(), now);
  }

  /**
   * Imports a validated backup. A board whose id and last-edit time match an existing board
   * is skipped (already there); a board whose id exists with other content is imported as a
   * new board, so nothing is overwritten.
   */
  async importBackup(backup: Backup): Promise<{ imported: number; skipped: number; libraryItems: number }> {
    const { boards } = await this.list();
    const byId = new Map(boards.map((b) => [b.id, b]));
    const titles = boards.map((b) => b.title);
    let imported = 0;
    let skipped = 0;
    for (const b of backup.boards) {
      const existing = byId.get(b.meta.id);
      if (existing && existing.updatedAt === b.meta.updatedAt) {
        skipped++;
        continue;
      }
      const meta: BoardMeta = existing ? { ...b.meta, id: newId('b_'), title: uniqueTitle(b.meta.title, titles) } : { ...b.meta };
      titles.push(meta.title);
      const wanted = referencedFileIds(b.scene.elements);
      await this.writeAll({ meta, scene: { ...b.scene, id: meta.id }, files: b.files.filter((f) => wanted.has(f.id)), thumbnail: null });
      imported++;
    }
    const libraryItems = backup.library.length ? await this.addToLibrary(backup.library) : 0;
    if (imported) this.emit('list');
    return { imported, skipped, libraryItems };
  }
}

export { SchemaError };
