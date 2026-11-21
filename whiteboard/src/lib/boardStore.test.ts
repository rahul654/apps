import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardStore } from './boardStore';
import { parseBackup } from './backup';
import { newId } from './id';
import { request, STORES } from './db';
import { TEMPLATES } from './templates';

const png = (n: number) => ({ id: `f${n}`, mimeType: 'image/png', dataURL: `data:image/png;base64,${'A'.repeat(n * 4)}`, created: n });
const image = (id: string, fileId: string) => ({ id, type: 'image', fileId, x: 0, y: 0, width: 10, height: 10 });
const rect = (id: string) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 });

let store: BoardStore;
beforeEach(() => {
  store = new BoardStore(`test-${newId()}`);
});
afterEach(async () => {
  await store.close();
});

async function rawDb(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

describe('BoardStore CRUD', () => {
  it('creates boards with unique titles and lists them', async () => {
    const a = await store.create({}, 1000);
    const b = await store.create({ title: '  ' }, 2000);
    const c = await store.create({ title: 'Plan' }, 3000);
    expect([a.title, b.title, c.title]).toEqual(['Untitled board', 'Untitled board 2', 'Plan']);
    expect(a).toMatchObject({ createdAt: 1000, updatedAt: 1000, elementCount: 0, revision: 1, schemaVersion: 1 });
    const { boards, invalid } = await store.list();
    expect(boards.map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(invalid).toBe(0);
  });

  it('saves and loads scenes, files and appState', async () => {
    const m = await store.create({ title: 'Pics' }, 1);
    const saved = await store.save(m.id, { elements: [image('i1', 'f1'), rect('r1')], appState: { viewBackgroundColor: '#eee', theme: 'dark' }, files: [png(1), png(2)] }, 50);
    expect(saved).toMatchObject({ elementCount: 2, updatedAt: 50, revision: 2 });
    const loaded = (await store.load(m.id))!;
    expect(loaded.scene.elements.map((e) => e.id)).toEqual(['i1', 'r1']);
    expect(loaded.scene.appState).toEqual({ viewBackgroundColor: '#eee' });
    // f2 isn't referenced by any image element, so it isn't stored.
    expect(loaded.files.map((f) => f.id)).toEqual(['f1']);
  });

  it('saves without counting as an edit when touch is false', async () => {
    const m = await store.create({}, 1);
    const events: string[] = [];
    store.subscribe((k) => events.push(k));
    const s = await store.save(m.id, { elements: [], appState: { scrollX: 40 }, files: [] }, 99, { touch: false });
    expect(s).toMatchObject({ updatedAt: 1, revision: 1 });
    expect((await store.load(m.id))!.scene.appState).toEqual({ scrollX: 40 });
    expect(events).toEqual([]);
  });

  it('removes files once no image uses them, and keeps files of other boards', async () => {
    const a = await store.create({ elements: [image('i', 'f1')], files: [png(1)] });
    const b = await store.create({ elements: [image('i', 'f1')], files: [png(1)] });
    await store.save(a.id, { elements: [rect('r')], appState: {}, files: [png(1)] });
    expect((await store.load(a.id))!.files).toEqual([]);
    expect((await store.load(b.id))!.files.map((f) => f.id)).toEqual(['f1']);
  });

  it('renames, duplicates (with files and thumbnail) and keeps titles distinct', async () => {
    const m = await store.create({ title: 'Plan', elements: [image('i', 'f1')], files: [png(1)] }, 1);
    await store.setThumbnail(m.id, 'data:image/png;base64,T', 1);
    const renamed = await store.rename(m.id, '  Road   map ', 10);
    expect(renamed).toMatchObject({ title: 'Road map', updatedAt: 10 });
    expect(await store.rename(m.id, '', 11)).toMatchObject({ title: 'Untitled board' });
    await store.rename(m.id, 'Road map', 12);
    const copy = await store.duplicate(m.id, 20);
    expect(copy.title).toBe('Road map (copy)');
    expect(copy.id).not.toBe(m.id);
    expect((await store.load(copy.id))!.files.map((f) => f.id)).toEqual(['f1']);
    expect((await store.thumbnails()).get(copy.id)?.dataURL).toBe('data:image/png;base64,T');
    expect((await store.duplicate(m.id)).title).toBe('Road map (copy 2)');
  });

  it('deletes everything for a board and restores it for undo', async () => {
    const m = await store.create({ title: 'Gone', elements: [image('i', 'f1')], files: [png(1)] });
    await store.setThumbnail(m.id, 'data:image/png;base64,T', 1);
    const snap = (await store.remove(m.id))!;
    expect(await store.load(m.id)).toBeNull();
    expect((await store.list()).boards).toEqual([]);
    expect((await store.thumbnails()).size).toBe(0);
    const db = await rawDb(store.dbName);
    expect(await request(db.transaction(STORES.files).objectStore(STORES.files).count())).toBe(0);
    db.close();
    await store.restore(snap);
    const back = (await store.load(m.id))!;
    expect(back.meta).toEqual(snap.meta);
    expect(back.files.map((f) => f.id)).toEqual(['f1']);
    expect((await store.thumbnails()).get(m.id)?.dataURL).toBe('data:image/png;base64,T');
  });

  it('rejects saving or renaming a missing board and leaves no partial writes', async () => {
    await expect(store.save('nope', { elements: [rect('r')], appState: {}, files: [] })).rejects.toThrow(/not found/);
    await expect(store.rename('nope', 'x')).rejects.toThrow(/not found/);
    expect((await store.list()).boards).toEqual([]);
    const db = await rawDb(store.dbName);
    expect(await request(db.transaction(STORES.scenes).objectStore(STORES.scenes).count())).toBe(0);
    db.close();
    await store.setThumbnail('nope', 'data:x', 1);
    expect((await store.thumbnails()).size).toBe(0);
  });

  it('validates and migrates stored records on load, skipping broken ones', async () => {
    await store.list(); // creates the database
    const db = await rawDb(store.dbName);
    const tx = db.transaction([STORES.boards, STORES.scenes], 'readwrite');
    tx.objectStore(STORES.boards).put({ id: 'legacy', name: 'Old one', created: 5, updated: 6 });
    tx.objectStore(STORES.scenes).put({ id: 'legacy', elements: [rect('r'), { bad: true }] });
    tx.objectStore(STORES.boards).put({ id: 'future', title: 'New', schemaVersion: 99 });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
    const { boards, invalid } = await store.list();
    expect(boards).toEqual([{ id: 'legacy', title: 'Old one', createdAt: 5, updatedAt: 6, elementCount: 0, schemaVersion: 1, revision: 0 }]);
    expect(invalid).toBe(1);
    expect((await store.load('legacy'))!.scene.elements.map((e) => e.id)).toEqual(['r']);
    await expect(store.load('future')).rejects.toThrow(/newer version/);
  });

  it('notifies subscribers of changes', async () => {
    const events: string[] = [];
    const off = store.subscribe((kind) => events.push(kind));
    const m = await store.create();
    await store.rename(m.id, 'x');
    await store.setLibrary([]);
    off();
    await store.rename(m.id, 'y');
    expect(events).toEqual(['list', 'list', 'library']);
  });

  it('persists library items and merges new ones by id', async () => {
    expect(await store.getLibrary()).toEqual([]);
    await store.setLibrary([{ id: 'L1', status: 'unpublished', elements: [rect('r')], created: 1 }, { id: 'bad', elements: [] }]);
    expect((await store.getLibrary()).map((i) => i.id)).toEqual(['L1']);
    expect(await store.addToLibrary([{ id: 'L1', elements: [rect('r')] }, { id: 'L2', elements: [rect('q')] }])).toBe(1);
    expect((await store.getLibrary()).map((i) => i.id)).toEqual(['L2', 'L1']);
  });

  it('creates boards from every template', async () => {
    for (const t of TEMPLATES) {
      const { elements, appState } = t.build();
      const m = await store.create({ title: t.name, elements, appState, template: t.id });
      expect(m.elementCount).toBe(elements.length);
      expect((await store.load(m.id))!.scene.elements).toEqual(elements);
    }
  });
});

describe('backup', () => {
  it('round-trips every board, file and library item into an empty store', async () => {
    const a = await store.create({ title: 'A', elements: [image('i', 'f1'), rect('r')], files: [png(1)], appState: { gridSize: 20 } }, 100);
    const b = await store.create({ title: 'B', elements: TEMPLATES[0].build().elements }, 200);
    await store.setLibrary([{ id: 'L1', elements: [rect('x')] }]);
    const json = JSON.stringify(await store.exportAll(new Date(0)));

    const { backup, invalid } = parseBackup(JSON.parse(json));
    expect(invalid).toBe(0);
    expect(backup.exportedAt).toBe('1970-01-01T00:00:00.000Z');
    const other = new BoardStore(`test-${newId()}`);
    try {
      expect(await other.importBackup(backup)).toEqual({ imported: 2, skipped: 0, libraryItems: 1 });
      for (const m of [a, b]) {
        const want = (await store.load(m.id))!;
        expect(await other.load(m.id)).toEqual(want);
      }
      expect((await other.getLibrary()).map((i) => i.id)).toEqual(['L1']);
      // Importing the same backup again changes nothing.
      expect(await other.importBackup(backup)).toEqual({ imported: 0, skipped: 2, libraryItems: 0 });
      expect((await other.list()).boards).toHaveLength(2);
    } finally {
      await other.close();
    }
  });

  it('imports a board whose id exists with other content as a new board', async () => {
    const a = await store.create({ title: 'A', elements: [rect('r')] }, 100);
    const { backup } = parseBackup(JSON.parse(JSON.stringify(await store.exportAll())));
    await store.save(a.id, { elements: [rect('r'), rect('s')], appState: {}, files: [] }, 500);
    expect(await store.importBackup(backup)).toEqual({ imported: 1, skipped: 0, libraryItems: 0 });
    const titles = (await store.list()).boards.map((x) => x.title).sort();
    expect(titles).toEqual(['A', 'A 2']);
  });

  it('skips invalid boards and rejects non-backups', () => {
    const { backup, invalid } = parseBackup({ type: 'whiteboard-backup', version: 1, boards: [{ meta: { title: 'no id' } }, { meta: { id: 'ok', schemaVersion: 1 }, scene: { schemaVersion: 1, elements: [rect('r')] }, files: [] }] });
    expect(invalid).toBe(1);
    expect(backup.boards.map((x) => [x.meta.id, x.meta.elementCount])).toEqual([['ok', 1]]);
    expect(() => parseBackup({ type: 'excalidraw' })).toThrow(/Not a Whiteboard backup/);
    expect(() => parseBackup({ type: 'whiteboard-backup', version: 9 })).toThrow(/newer version/);
  });
});
