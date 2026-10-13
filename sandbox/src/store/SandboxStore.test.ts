import { describe, expect, it } from 'vitest';
import { createSandbox } from '../lib/defaults';
import type { Sandbox } from '../types';
import { reducer } from './SandboxStore';

const state = (sandboxes: Sandbox[]) => ({ data: { version: 1 as const, sandboxes }, removed: null, dirty: false });

describe('reducer', () => {
  it('auto-names from the URL until the user renames', () => {
    const sb = createSandbox('web');
    let s = reducer(state([sb]), { type: 'update', id: sb.id, patch: { url: 'https://www.example.com/' } }, 5);
    expect(s.data.sandboxes[0]).toMatchObject({ name: 'example.com', autoName: true, updatedAt: 5 });
    expect(s.dirty).toBe(true);

    s = reducer(s, { type: 'update', id: sb.id, patch: { name: '  Docs  ' } });
    expect(s.data.sandboxes[0]).toMatchObject({ name: 'Docs', autoName: false });
    s = reducer(s, { type: 'update', id: sb.id, patch: { url: 'https://other.example/' } });
    expect(s.data.sandboxes[0].name).toBe('Docs');

    // Clearing the name goes back to following the URL.
    s = reducer(s, { type: 'update', id: sb.id, patch: { name: '' } });
    expect(s.data.sandboxes[0]).toMatchObject({ name: 'other.example', autoName: true });
  });

  it('removes with undo info and restores at the same position', () => {
    const [a, b, c] = [createSandbox('web'), createSandbox('html'), createSandbox('web')];
    let s = reducer(state([a, b, c]), { type: 'remove', id: b.id });
    expect(s.data.sandboxes.map((x) => x.id)).toEqual([a.id, c.id]);
    expect(s.removed).toEqual({ sandbox: b, index: 1 });

    s = reducer(s, { type: 'restore', ...s.removed! });
    expect(s.data.sandboxes.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(s.removed).toBeNull();
    // Restoring twice is a no-op.
    expect(reducer(s, { type: 'restore', sandbox: b, index: 0 })).toBe(s);
  });

  it('ignores removing unknown ids; sync replaces data without marking it dirty', () => {
    const a = createSandbox('web');
    const s = state([a]);
    expect(reducer(s, { type: 'remove', id: 'nope' })).toBe(s);
    const synced = reducer({ ...s, dirty: true }, { type: 'sync', data: { version: 1, sandboxes: [] } });
    expect(synced.data.sandboxes).toEqual([]);
    expect(synced.dirty).toBe(false);
  });
});
