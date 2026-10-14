import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardStore } from './boardStore';
import { describeImport, importFiles } from './importFiles';
import { newId } from './id';
import { serializeScene } from './excalidrawFile';

const file = (name: string, text: string) => new File([text], name, { type: 'application/json' });
let store: BoardStore;
beforeEach(() => {
  store = new BoardStore(`test-${newId()}`);
});
afterEach(() => store.close());

describe('importFiles', () => {
  it('imports drawings, libraries and backups and reports bad files', async () => {
    const scene = serializeScene({ elements: [{ id: 'a', type: 'rectangle' }], appState: {}, files: [] });
    const named = JSON.stringify({ type: 'excalidraw', elements: [], appState: { name: 'From name' } });
    const lib = JSON.stringify({ type: 'excalidrawlib', version: 2, libraryItems: [{ id: 'L', elements: [{ id: 'x', type: 'ellipse' }] }] });
    const other = new BoardStore(`test-${newId()}`);
    await other.create({ title: 'Backed up' });
    const backup = JSON.stringify(await other.exportAll());
    await other.close();

    const s = await importFiles(store, [file('Q3_plan.excalidraw', scene), file('x.excalidraw', named), file('shapes.excalidrawlib', lib), file('backup.json', backup), file('notes.txt', 'hello'), file('p.json', '{"type":"other"}')]);
    expect(s.boards.map((b) => [b.title, b.elementCount])).toEqual([
      ['Q3 plan', 1],
      ['From name', 0],
    ]);
    expect(s.fromBackups).toBe(1);
    expect(s.libraryItems).toBe(1);
    expect(s.errors).toHaveLength(2);
    expect((await store.list()).boards.map((b) => b.title).sort()).toEqual(['Backed up', 'From name', 'Q3 plan']);
    expect(describeImport(s)).toBe('Imported 3 boards, added 1 library item. Couldn’t import notes.txt: it isn’t an Excalidraw or backup file; p.json: it isn’t an Excalidraw or backup file.');
  });

  it('describes empty and skip-only results', () => {
    expect(describeImport({ boards: [], fromBackups: 0, skipped: 0, libraryItems: 0, errors: [] })).toBe('Nothing to import.');
    expect(describeImport({ boards: [], fromBackups: 0, skipped: 2, libraryItems: 0, errors: [] })).toBe('2 boards already here.');
  });
});
