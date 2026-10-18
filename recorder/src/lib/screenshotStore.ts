/**
 * IndexedDB storage for screenshots (same "recorder" database as recordings, v2 stores).
 *
 *   shots       key: id  → ScreenshotMeta (incl. the annotation scene)
 *   shotImages  key: id  → { id, data: Blob }  the original capture, never modified
 *   thumbs      key: id  → { id, data: Blob }  shared with recordings (ids are unique)
 *
 * The annotated image is rendered on demand (download / copy), so editing only writes the
 * small scene object.
 */
import { parseScene, type Scene } from './annotations';
import { done, req } from './idb';
import { recorderDb } from './recordingStore';

export type ShotSource = 'display' | 'recording' | 'paste';

export interface ScreenshotMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  /** Size of the original image. */
  size: number;
  mimeType: string;
  source: ShotSource;
  scene: Scene;
  hasThumb: boolean;
}

/** Validates a stored row; null when it can't be shown. */
export function parseShotMeta(v: unknown): ScreenshotMeta | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const pos = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (typeof o.id !== 'string' || !pos(o.width) || !pos(o.height)) return null;
  const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
  return {
    id: o.id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : 'Untitled screenshot',
    createdAt: num(o.createdAt, 0),
    updatedAt: num(o.updatedAt, num(o.createdAt, 0)),
    width: o.width as number,
    height: o.height as number,
    size: num(o.size, 0),
    mimeType: typeof o.mimeType === 'string' ? o.mimeType : 'image/png',
    source: o.source === 'recording' || o.source === 'paste' ? o.source : 'display',
    scene: parseScene(o.scene),
    hasThumb: o.hasThumb === true,
  };
}

export class ScreenshotStore {
  private db: Promise<IDBDatabase>;
  constructor(db: Promise<IDBDatabase>) {
    this.db = db;
  }

  async create(meta: Omit<ScreenshotMeta, 'size' | 'updatedAt' | 'hasThumb' | 'mimeType' | 'scene'> & { scene?: Scene }, image: Blob): Promise<ScreenshotMeta> {
    const full: ScreenshotMeta = { ...meta, scene: meta.scene ?? { annotations: [], crop: null }, size: image.size, mimeType: image.type || 'image/png', hasThumb: false, updatedAt: meta.createdAt };
    const db = await this.db;
    const tx = db.transaction(['shots', 'shotImages'], 'readwrite');
    tx.objectStore('shots').add(full);
    tx.objectStore('shotImages').put({ id: full.id, data: image });
    await done(tx);
    return full;
  }

  async get(id: string): Promise<ScreenshotMeta | undefined> {
    const db = await this.db;
    return parseShotMeta(await req(db.transaction('shots').objectStore('shots').get(id))) ?? undefined;
  }

  async list(): Promise<ScreenshotMeta[]> {
    const db = await this.db;
    const rows = (await req(db.transaction('shots').objectStore('shots').getAll())) as unknown[];
    return rows.map(parseShotMeta).filter((m): m is ScreenshotMeta => m !== null);
  }

  async getImage(id: string): Promise<Blob | null> {
    const db = await this.db;
    const row = (await req(db.transaction('shotImages').objectStore('shotImages').get(id))) as { data: Blob } | undefined;
    return row?.data ?? null;
  }

  async update(id: string, patch: Partial<Pick<ScreenshotMeta, 'title' | 'scene'>>): Promise<ScreenshotMeta | undefined> {
    const db = await this.db;
    const tx = db.transaction('shots', 'readwrite');
    const store = tx.objectStore('shots');
    const meta = parseShotMeta(await req(store.get(id)));
    let next: ScreenshotMeta | undefined;
    if (meta) {
      next = { ...meta, ...patch, id, updatedAt: Date.now() };
      store.put(next);
    }
    await done(tx);
    return next;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.update(id, { title: title.trim() || 'Untitled screenshot' });
  }

  async setThumbnail(id: string, data: Blob): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['thumbs', 'shots'], 'readwrite');
    tx.objectStore('thumbs').put({ id, data });
    const shots = tx.objectStore('shots');
    const meta = parseShotMeta(await req(shots.get(id)));
    if (meta && !meta.hasThumb) shots.put({ ...meta, hasThumb: true });
    await done(tx);
  }

  async delete(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['shots', 'shotImages', 'thumbs'], 'readwrite');
    tx.objectStore('shots').delete(id);
    tx.objectStore('shotImages').delete(id);
    tx.objectStore('thumbs').delete(id);
    await done(tx);
  }
}

let shared: ScreenshotStore | null = null;
/** App-wide store on the real IndexedDB. */
export function screenshotStore(): ScreenshotStore {
  if (!shared) shared = new ScreenshotStore(recorderDb());
  return shared;
}
