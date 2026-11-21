import { describe, expect, it } from 'vitest';
import { exampleTabId, moveTab, requestTabId, shiftTab, type TabsState } from '../tabs';
import { findItem } from './items';
import { collectionId } from './normalize';
import { cloneWithNewIds, destinationName, destinationOptions, transferItem, transferProblem } from './transfer';
import type { PmCollection } from './types';

const col = (id: string, name: string, item: PmCollection['item']): PmCollection => ({ info: { _postman_id: id, name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item });
const req = (id: string, name = id, examples: string[] = []) => ({ id, name, request: { method: 'GET', url: `https://x/${id}` }, response: examples.map((e) => ({ id: e, name: e })) });

const fixtures = () => {
  const a = col('A', 'as', [req('r1', 'request1', ['ex1']), { id: 'f1', name: 'Folder', item: [req('r2'), { id: 'f2', name: 'Sub', item: [req('r3')] }] }, req('r4')]);
  const b = col('B', 'collection2', [req('b1')]);
  return [a, b];
};
const names = (c: PmCollection) => c.item.map((i) => i.name);

describe('transferItem', () => {
  it('moves a request to another collection, keeping ids so its open tabs (and examples) follow', () => {
    const [a, b] = fixtures();
    const r = transferItem([a, b], { cid: 'A', id: 'r1' }, { cid: 'B', parentId: null }, 'move')!;
    const [na, nb] = r.changed;
    expect(collectionId(na)).toBe('A');
    expect(findItem(na, 'r1')).toBeNull();
    expect(names(nb)).toEqual(['b1', 'request1']);
    expect(findItem(nb, 'r1')).not.toBeNull();
    expect(r.tabMoves).toEqual([
      [requestTabId('A', 'r1'), requestTabId('B', 'r1')],
      [exampleTabId('A', 'r1', 'ex1'), exampleTabId('B', 'r1', 'ex1')],
    ]);
  });

  it('copies with fresh ids for the request and its examples; the source stays', () => {
    const [a, b] = fixtures();
    const r = transferItem([a, b], { cid: 'A', id: 'r1' }, { cid: 'B', parentId: null, index: 0 }, 'copy')!;
    expect(r.changed).toHaveLength(1);
    const nb = r.changed[0];
    expect(names(nb)).toEqual(['request1', 'b1']);
    expect(nb.item[0].id).not.toBe('r1');
    expect((nb.item[0] as { response: { id: string }[] }).response[0].id).not.toBe('ex1');
    expect(r.tabMoves).toEqual([]);
  });

  it('moves a whole folder across collections with every request inside', () => {
    const [a, b] = fixtures();
    const r = transferItem([a, b], { cid: 'A', id: 'f1' }, { cid: 'B', parentId: null }, 'move')!;
    expect(r.tabMoves.map(([x]) => x)).toEqual([requestTabId('A', 'r2'), requestTabId('A', 'r3')]);
    expect(findItem(r.changed[1], 'r3')?.parents.map((p) => p.name)).toEqual(['Folder', 'Sub']);
  });

  it('within a collection: reorders and moves into folders; refuses a folder into itself', () => {
    const [a, b] = fixtures();
    const up = transferItem([a, b], { cid: 'A', id: 'r4' }, { cid: 'A', parentId: null, index: 0 }, 'move')!;
    expect(names(up.changed[0])).toEqual(['r4', 'request1', 'Folder']);
    expect(up.tabMoves).toEqual([]);
    const into = transferItem([a, b], { cid: 'A', id: 'r1' }, { cid: 'A', parentId: 'f2' }, 'move')!;
    expect(findItem(into.changed[0], 'r1')?.parents.map((p) => p.id)).toEqual(['f1', 'f2']);
    expect(transferProblem([a, b], { cid: 'A', id: 'f1' }, { cid: 'A', parentId: 'f2' }, 'move')).toMatch(/inside itself/);
    expect(transferItem([a, b], { cid: 'A', id: 'f1' }, { cid: 'A', parentId: 'f1' }, 'move')).toBeNull();
    // copying a folder into its own subfolder is fine (it's a new folder)
    expect(transferProblem([a, b], { cid: 'A', id: 'f1' }, { cid: 'A', parentId: 'f2' }, 'copy')).toBeNull();
  });

  it('treats dropping an item right next to itself as already there', () => {
    const [a, b] = fixtures();
    expect(transferProblem([a, b], { cid: 'A', id: 'r1' }, { cid: 'A', parentId: null, index: 0 }, 'move')).toMatch(/already there/);
    expect(transferProblem([a, b], { cid: 'A', id: 'r1' }, { cid: 'A', parentId: null, index: 1 }, 'move')).toMatch(/already there/);
    expect(transferProblem([a, b], { cid: 'A', id: 'r4' }, { cid: 'A', parentId: null }, 'move')).toMatch(/already there/);
    expect(transferProblem([a, b], { cid: 'A', id: 'r1' }, { cid: 'A', parentId: null, index: 2 }, 'move')).toBeNull();
  });

  it('copy within the same list is named "… copy"', () => {
    const [a, b] = fixtures();
    const r = transferItem([a, b], { cid: 'A', id: 'r1' }, { cid: 'A', parentId: null, index: 1 }, 'copy')!;
    expect(names(r.changed[0])).toEqual(['request1', 'request1 copy', 'Folder', 'r4']);
  });

  it('gives a copy new ids when the target already has the same ids', () => {
    const [a] = fixtures();
    const b = col('B', 'collection2', [req('r1', 'same id elsewhere')]);
    const r = transferItem([a, b], { cid: 'A', id: 'r1' }, { cid: 'B', parentId: null }, 'move')!;
    expect(r.changed[1].item[1].id).not.toBe('r1');
    expect(r.tabMoves).toEqual([]);
  });

  it('lists destinations and names them', () => {
    const [a, b] = fixtures();
    const opts = destinationOptions([a, b]);
    expect(opts.map((o) => o.label)).toEqual(['as', 'as / Folder', 'as / Folder / Sub', 'collection2']);
    expect(destinationName([a, b], { cid: 'A', parentId: 'f2' })).toBe('as / Folder / Sub');
  });

  it('cloneWithNewIds changes every id', () => {
    const [a] = fixtures();
    const c = cloneWithNewIds(a.item[1]);
    expect(JSON.stringify(c)).not.toMatch(/"id":"(f1|f2|r2|r3)"/);
  });
});

describe('moveTab / shiftTab', () => {
  const s: TabsState = { tabs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], activeId: 'b' };
  const ids = (x: TabsState) => x.tabs.map((t) => t.id).join('');
  it('drops before or after the target and keeps the active tab', () => {
    expect(ids(moveTab(s, 'a', 'c', 'after'))).toBe('bcad');
    expect(ids(moveTab(s, 'd', 'a', 'before'))).toBe('dabc');
    expect(moveTab(s, 'a', 'b', 'before')).toBe(s); // no change
    expect(moveTab(s, 'a', 'a', 'after')).toBe(s);
    expect(moveTab(s, 'x', 'a', 'after')).toBe(s);
    expect(moveTab(s, 'a', 'c', 'after').activeId).toBe('b');
  });
  it('shifts one place, stopping at the ends', () => {
    expect(ids(shiftTab(s, 'b', 1))).toBe('acbd');
    expect(ids(shiftTab(s, 'b', -1))).toBe('bacd');
    expect(shiftTab(s, 'a', -1)).toBe(s);
    expect(shiftTab(s, 'd', 1)).toBe(s);
  });
});
