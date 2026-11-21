import { describe, expect, it } from 'vitest';
import { migrateRecord, pickAppState, referencedFileIds, SchemaError, validateElements, validateFiles, validateMeta, validateScene, type Migration } from './schema';
import { SCHEMA_VERSION } from './types';

describe('validation', () => {
  it('keeps valid elements and drops broken, deleted and duplicate ones', () => {
    const { elements, dropped } = validateElements([
      { id: 'a', type: 'rectangle' },
      { id: 'a', type: 'ellipse' },
      { id: 'b', type: 'text', isDeleted: true },
      { type: 'line' },
      'junk',
      null,
    ]);
    expect(elements.map((e) => e.id)).toEqual(['a']);
    expect(dropped).toBe(4);
    expect(validateElements('nope')).toEqual({ elements: [], dropped: 0 });
  });

  it('picks only known, JSON-safe appState keys', () => {
    const s = pickAppState({ viewBackgroundColor: '#fff', theme: 'dark', selectedElementIds: { a: true }, scrollX: NaN, zoom: { value: 2 }, gridSize: 20 });
    expect(s).toEqual({ viewBackgroundColor: '#fff', zoom: { value: 2 }, gridSize: 20 });
    expect(pickAppState({ zoom: { value: 0 } })).toEqual({});
    expect(pickAppState(null)).toEqual({});
  });

  it('validates files from a record or an array', () => {
    const f = { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1 };
    expect(validateFiles({ f1: f })).toEqual([f]);
    expect(validateFiles([f, f, { id: 'x', dataURL: 'http://evil' }, { id: 'y', dataURL: 'data:image/jpeg;base64,AA' }]).map((x) => [x.id, x.mimeType])).toEqual([
      ['f1', 'image/png'],
      ['y', 'image/jpeg'],
    ]);
  });

  it('finds referenced image files', () => {
    expect([...referencedFileIds([{ id: '1', type: 'image', fileId: 'f' }, { id: '2', type: 'rectangle', fileId: 'g' }, { id: '3', type: 'image', fileId: 'h', isDeleted: true }])]).toEqual(['f']);
  });

  it('validates metadata with defaults', () => {
    const m = validateMeta({ id: 'b1', title: '  Hi  ', createdAt: 5, schemaVersion: 1 }, 99);
    expect(m).toEqual({ id: 'b1', title: 'Hi', createdAt: 5, updatedAt: 5, elementCount: 0, schemaVersion: SCHEMA_VERSION, revision: 0 });
    expect(validateMeta({ id: 'b2', schemaVersion: 1 }, 99).title).toBe('Untitled board');
    expect(() => validateMeta({ title: 'x', schemaVersion: 1 })).toThrow(SchemaError);
    expect(() => validateMeta('x')).toThrow(SchemaError);
  });

  it('validates scenes and tolerates a missing scene', () => {
    expect(validateScene(undefined, 'b')).toEqual({ id: 'b', elements: [], appState: {}, schemaVersion: SCHEMA_VERSION });
    const s = validateScene({ schemaVersion: 1, elements: [{ id: 'e', type: 'arrow' }, 4], appState: { gridSize: 10, openDialog: 'x' } }, 'b');
    expect(s.elements).toHaveLength(1);
    expect(s.appState).toEqual({ gridSize: 10 });
  });
});

describe('migrations', () => {
  it('upgrades unversioned (v0) records', () => {
    const m = validateMeta({ id: 'old', name: 'Legacy board', created: 1, updated: 2 });
    expect(m).toMatchObject({ id: 'old', title: 'Legacy board', createdAt: 1, updatedAt: 2, schemaVersion: SCHEMA_VERSION });
  });

  it('chains steps in order up to the target version', () => {
    const steps: Record<number, Migration> = {
      0: (r) => ({ ...r, trail: ['0→1'] }),
      1: (r) => ({ ...r, trail: [...(r.trail as string[]), '1→2'] }),
      2: (r) => ({ ...r, trail: [...(r.trail as string[]), '2→3'] }),
    };
    expect(migrateRecord({ id: 'x' }, steps, 3)).toEqual({ id: 'x', trail: ['0→1', '1→2', '2→3'], schemaVersion: 3 });
    expect(migrateRecord({ id: 'x', schemaVersion: 2, trail: [] }, steps, 3)).toEqual({ id: 'x', trail: ['2→3'], schemaVersion: 3 });
  });

  it('rejects data from a newer version and gaps in the chain', () => {
    expect(() => migrateRecord({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
    expect(() => migrateRecord({ schemaVersion: 0 }, {}, 1)).toThrow(/No migration/);
    expect(() => migrateRecord({ schemaVersion: -1 })).toThrow(SchemaError);
  });
});
