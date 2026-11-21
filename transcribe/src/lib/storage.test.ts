import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Transcript } from '../types';
import { parseSegments, parseTranscript, TranscriptStore } from './storage';

const base = (over: Partial<Transcript> = {}): Transcript => ({
  version: 1,
  id: 'id1',
  title: 'Talk',
  createdAt: 10,
  updatedAt: 20,
  duration: 5,
  source: 'file',
  model: 'Xenova/whisper-tiny',
  task: 'transcribe',
  timestamps: 'segment',
  hasAudio: false,
  segmentCount: 2,
  wordCount: 3,
  segments: [
    { id: 'b', start: 2, end: 3, text: 'world again' },
    { id: 'a', start: 0, end: 1, text: 'hello' },
  ],
  ...over,
});

describe('validation', () => {
  it('accepts a good record and sorts its segments', () => {
    const t = parseTranscript(base())!;
    expect(t.segments.map((s) => s.id)).toEqual(['a', 'b']);
    expect(t.wordCount).toBe(3);
  });

  it('rejects non-objects, missing ids and missing segments', () => {
    expect(parseTranscript(null)).toBeNull();
    expect(parseTranscript('x')).toBeNull();
    expect(parseTranscript({ ...base(), id: '' })).toBeNull();
    expect(parseTranscript({ ...base(), segments: 'nope' })).toBeNull();
    expect(parseTranscript({ ...base(), title: 5 })).toBeNull();
  });

  it('drops bad segments and repairs fixable ones', () => {
    const segs = parseSegments([
      { id: 'x', start: 1, end: 0.5, text: 'end before start' },
      { start: -1, end: 2, text: 'negative' },
      { start: 'a', end: 2, text: 'string time' },
      { start: 3, end: Infinity, text: 'infinite' },
      { id: 'x', start: 4, end: 5, text: 'duplicate id' },
      { start: 6, end: 7, text: 'bad words', words: [{ text: 'w', start: 'nope', end: 1 }] },
      null,
    ])!;
    expect(segs.map((s) => s.text)).toEqual(['end before start', 'duplicate id', 'bad words']);
    expect(segs[0].end).toBe(1);
    expect(new Set(segs.map((s) => s.id)).size).toBe(3);
    expect(segs[2].words).toBeUndefined();
  });

  it('falls back on unknown enum values', () => {
    const t = parseTranscript({ ...base(), task: 'summarise', source: 'tape', timestamps: 'bogus', backend: 'cuda' })!;
    expect(t.task).toBe('transcribe');
    expect(t.source).toBe('import');
    expect(t.timestamps).toBe('segment');
    expect(t.backend).toBeUndefined();
  });

  it('fills defaults for imports', () => {
    const t = parseTranscript({ segments: [{ start: 0, end: 1, text: 'hi' }] }, { id: 'new', title: 'file', hasAudio: false })!;
    expect(t).toMatchObject({ id: 'new', title: 'file', source: 'import', duration: 1, hasAudio: false, segmentCount: 1 });
    expect(parseTranscript({ segments: [] })).toBeNull();
  });
});

describe('TranscriptStore (IndexedDB)', () => {
  const store = () => new TranscriptStore(() => new IDBFactory(), 'test');

  it('puts, lists, renames and removes with audio', async () => {
    const s = store();
    let changes = 0;
    s.subscribe(() => changes++);
    await s.put(base(), new Blob(['abc'], { type: 'audio/wav' }));
    await s.put(base({ id: 'id2', title: 'Newer', updatedAt: 99 }));
    const list = await s.list();
    expect(list.map((m) => m.id)).toEqual(['id2', 'id1']);
    expect(list[1]).toMatchObject({ hasAudio: true, audioType: 'audio/wav', audioBytes: 3 });
    expect('segments' in list[0]).toBe(false);
    const blob = await s.getAudio('id1');
    expect(blob?.size).toBe(3);
    await s.rename('id1', '  Renamed  ');
    expect((await s.get('id1'))?.title).toBe('Renamed');
    await s.removeAudio('id1');
    expect(await s.getAudio('id1')).toBeNull();
    expect((await s.get('id1'))?.hasAudio).toBe(false);
    await s.remove('id1');
    expect(await s.get('id1')).toBeNull();
    expect((await s.list()).map((m) => m.id)).toEqual(['id2']);
    expect(changes).toBe(5);
  });

  it('skips damaged records instead of failing the list', async () => {
    const factory = new IDBFactory();
    const s = new TranscriptStore(() => factory, 'test2');
    await s.put(base());
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = factory.open('test2');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res) => {
      const tx = db.transaction('transcripts', 'readwrite');
      tx.objectStore('transcripts').put({ id: 'broken', segments: 42 });
      tx.oncomplete = () => res();
    });
    db.close();
    expect((await s.list()).map((m) => m.id)).toEqual(['id1']);
    expect(await s.get('broken')).toBeNull();
  });
});
