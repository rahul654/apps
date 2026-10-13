import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { findRecoverable, openRecorderDb, recoverRecording, RecordingStore, type RecordingMeta } from './recordingStore';
import { patchWebmHead, readWebmDuration } from './webmDuration';

let store: RecordingStore;
beforeEach(() => {
  store = new RecordingStore(openRecorderDb(new IDBFactory()));
});

const meta = (id: string, over: Partial<RecordingMeta> = {}): RecordingMeta => ({
  id,
  title: `Recording ${id}`,
  createdAt: 1000,
  updatedAt: 1000,
  durationMs: 0,
  size: 0,
  mimeType: 'video/webm;codecs=vp8,opus',
  mode: 'screen',
  status: 'recording',
  chunkCount: 0,
  hasThumb: false,
  ...over,
});

const text = (b: Blob) => b.text();

describe('RecordingStore', () => {
  it('appends chunks in order and tracks size, count and duration', async () => {
    await store.create(meta('a'));
    await store.appendChunk('a', 0, new Blob(['hello ']), 1000);
    await store.appendChunk('a', 1, new Blob(['world']), 2000);
    const m = await store.get('a');
    expect(m).toMatchObject({ size: 11, chunkCount: 2, durationMs: 2000 });
    expect(await text(await store.getBlob('a'))).toBe('hello world');
    expect((await store.getBlob('a')).type).toBe('video/webm;codecs=vp8,opus');
  });

  it('orders chunks numerically (seq 10 after seq 9)', async () => {
    await store.create(meta('n'));
    for (let i = 0; i < 12; i++) await store.appendChunk('n', i, new Blob([String.fromCharCode(97 + i)]), i * 1000);
    expect(await text(await store.getBlob('n'))).toBe('abcdefghijkl');
  });

  it('keeps recordings separate', async () => {
    await store.create(meta('a'));
    await store.create(meta('b'));
    await store.appendChunk('a', 0, new Blob(['A']), 1);
    await store.appendChunk('b', 0, new Blob(['B']), 1);
    expect(await text(await store.getBlob('a'))).toBe('A');
    expect(await text(await store.getBlob('b'))).toBe('B');
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    expect((await store.getBlob('a')).size).toBe(0);
    expect(await text(await store.getBlob('b'))).toBe('B');
  });

  it('renames, updates and stores thumbnails', async () => {
    await store.create(meta('a'));
    await store.rename('a', '  Demo  ');
    expect((await store.get('a'))!.title).toBe('Demo');
    await store.rename('a', '   ');
    expect((await store.get('a'))!.title).toBe('Untitled recording');
    await store.setThumbnail('a', new Blob(['jpg']));
    expect((await store.get('a'))!.hasThumb).toBe(true);
    expect(await text((await store.getThumbnail('a'))!)).toBe('jpg');
    await store.delete('a');
    expect(await store.getThumbnail('a')).toBeNull();
  });

  it('saves a finished file as a single chunk', async () => {
    const saved = await store.saveFile(
      { id: 't', title: 'Trimmed', createdAt: 5, durationMs: 1234, mimeType: 'video/mp4', mode: 'edit', sourceId: 'a' },
      new Blob(['mp4data'], { type: 'video/mp4' }),
    );
    expect(saved).toMatchObject({ status: 'complete', size: 7, chunkCount: 1 });
    expect(await text(await store.getBlob('t'))).toBe('mp4data');
    expect((await store.list()).map((m) => m.id)).toEqual(['t']);
  });

  it('patchHead rewrites only the chunks covering the header', async () => {
    await store.create(meta('p'));
    await store.appendChunk('p', 0, new Blob(['ab']), 100);
    await store.appendChunk('p', 1, new Blob(['cd']), 200);
    await store.appendChunk('p', 2, new Blob(['efgh']), 300);
    // Replace the first 3 bytes ("abc") with "XYZW".
    const ok = await store.patchHead('p', 3, (head) => {
      expect(new TextDecoder().decode(head)).toBe('abc');
      return { bytes: new TextEncoder().encode('XYZW'), consumed: 3 };
    });
    expect(ok).toBe(true);
    expect(await text(await store.getBlob('p'))).toBe('XYZWdefgh');
    expect(await store.get('p')).toMatchObject({ size: 9, chunkCount: 2 });
    expect(await store.patchHead('p', 3, () => null)).toBe(false);
  });
});

describe('recovery', () => {
  it('finds stale unfinished recordings, newest first', () => {
    const metas = [
      meta('old', { createdAt: 1, updatedAt: 1 }),
      meta('new', { createdAt: 2, updatedAt: 2 }),
      meta('live', { createdAt: 3, updatedAt: 99_000 }),
      meta('done', { status: 'complete' }),
    ];
    expect(findRecoverable(metas, { now: 100_000 }).map((m) => m.id)).toEqual(['new', 'old']);
    // With Web Locks, a held lock (another tab recording) is what matters, not age.
    expect(findRecoverable(metas, { now: 100_000, activeIds: new Set(['new']) }).map((m) => m.id)).toEqual(['live', 'old']);
  });

  it('assembles chunks of a crashed recording and patches the WebM duration', async () => {
    const file = new Uint8Array(readFileSync(new URL('./__fixtures__/chrome-layout.webm', import.meta.url)));
    await store.create(meta('c', { title: 'Recording 2026-10-13 10:00' }));
    // Simulate MediaRecorder timeslices: header + first frames, then the rest.
    const cuts = [0, 300, 5000, file.length];
    for (let i = 0; i < cuts.length - 1; i++) {
      await store.appendChunk('c', i, new Blob([file.slice(cuts[i], cuts[i + 1])], { type: 'video/webm' }), (i + 1) * 650);
    }
    const before = await store.get('c');
    expect(findRecoverable([before!], { now: Date.now() + 60_000 })).toHaveLength(1);

    const recovered = await recoverRecording(store, 'c', patchWebmHead);
    expect(recovered).toMatchObject({ status: 'complete', durationMs: 1950, title: 'Recording 2026-10-13 10:00 (recovered)' });
    const blob = await store.getBlob('c');
    expect(blob.size).toBe(file.length + 11);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(readWebmDuration(bytes)).toBeCloseTo(1950, 6);
    expect(bytes.subarray(bytes.length - 5000)).toEqual(file.subarray(file.length - 5000));
    expect(recovered!.size).toBe(file.length + 11);
  });

  it('drops an unfinished recording with no data', async () => {
    await store.create(meta('empty'));
    expect(await recoverRecording(store, 'empty', patchWebmHead)).toBeUndefined();
    expect(await store.get('empty')).toBeUndefined();
  });
});
