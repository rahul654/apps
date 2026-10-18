import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openRecorderDb, RecordingStore } from './recordingStore';
import { parseShotMeta, ScreenshotStore } from './screenshotStore';

let factory: IDBFactory;
let shots: ScreenshotStore;
beforeEach(() => {
  factory = new IDBFactory();
  shots = new ScreenshotStore(openRecorderDb(factory));
});

const base = { id: 's1', title: 'Screenshot 2026-10-18 10:00', createdAt: 1000, width: 1920, height: 1080, source: 'display' as const };

describe('ScreenshotStore', () => {
  it('stores the original image and an empty scene', async () => {
    const saved = await shots.create(base, new Blob(['png-bytes'], { type: 'image/png' }));
    expect(saved).toMatchObject({ size: 9, mimeType: 'image/png', hasThumb: false, scene: { annotations: [], crop: null } });
    expect(await shots.get('s1')).toEqual(saved);
    expect(await (await shots.getImage('s1'))!.text()).toBe('png-bytes');
    expect((await shots.list()).map((m) => m.id)).toEqual(['s1']);
  });

  it('updates the scene and title without touching the image', async () => {
    await shots.create(base, new Blob(['img'], { type: 'image/png' }));
    const scene = { annotations: [{ id: 'h', type: 'highlight' as const, x: 1, y: 2, w: 30, h: 40, color: '#facc15' }], crop: { x: 0, y: 0, w: 100, h: 50 } };
    const next = await shots.update('s1', { scene });
    expect(next?.scene).toEqual(scene);
    await shots.rename('s1', '   ');
    expect((await shots.get('s1'))!.title).toBe('Untitled screenshot');
    expect((await shots.get('s1'))!.scene).toEqual(scene);
    expect(await (await shots.getImage('s1'))!.text()).toBe('img');
    expect(await shots.update('missing', { title: 'x' })).toBeUndefined();
  });

  it('thumbnails share the thumbs store and are removed with the screenshot', async () => {
    const db = openRecorderDb(factory);
    const recs = new RecordingStore(db);
    await shots.create(base, new Blob(['img']));
    await shots.setThumbnail('s1', new Blob(['jpg']));
    expect((await shots.get('s1'))!.hasThumb).toBe(true);
    expect(await (await recs.getThumbnail('s1'))!.text()).toBe('jpg');
    await shots.delete('s1');
    expect(await shots.get('s1')).toBeUndefined();
    expect(await shots.getImage('s1')).toBeNull();
    expect(await recs.getThumbnail('s1')).toBeNull();
  });

  it('hides rows that fail validation and repairs bad scenes', () => {
    expect(parseShotMeta({ id: 'x', width: 0, height: 10 })).toBeNull();
    expect(parseShotMeta(null)).toBeNull();
    const m = parseShotMeta({ id: 'x', width: 10, height: 10, scene: { annotations: [{ id: 'q', type: 'nope' }] }, source: 'alien' });
    expect(m).toMatchObject({ title: 'Untitled screenshot', source: 'display', scene: { annotations: [], crop: null } });
  });
});

describe('database upgrade', () => {
  it('v1 → v2 keeps recordings and adds the screenshot stores', async () => {
    const f = new IDBFactory();
    // A v1 database built the way the previous release did.
    const v1 = await openRecorderDb(f, 'recorder', 1);
    expect([...v1.objectStoreNames].sort()).toEqual(['chunks', 'recordings', 'thumbs']);
    const oldStore = new RecordingStore(Promise.resolve(v1));
    await oldStore.saveFile({ id: 'r1', title: 'Old clip', createdAt: 1, durationMs: 1000, mimeType: 'video/webm', mode: 'screen' }, new Blob(['webm']));
    await oldStore.setThumbnail('r1', new Blob(['thumb']));
    v1.close();

    const v2 = await openRecorderDb(f, 'recorder');
    expect(v2.version).toBe(2);
    expect([...v2.objectStoreNames].sort()).toEqual(['chunks', 'recordings', 'shotImages', 'shots', 'thumbs']);
    const recs = new RecordingStore(Promise.resolve(v2));
    expect((await recs.get('r1'))!.title).toBe('Old clip');
    expect(await (await recs.getBlob('r1')).text()).toBe('webm');
    expect(await (await recs.getThumbnail('r1'))!.text()).toBe('thumb');
    const s = new ScreenshotStore(Promise.resolve(v2));
    expect(await s.list()).toEqual([]);
  });
});
