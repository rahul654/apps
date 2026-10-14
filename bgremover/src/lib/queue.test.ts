import { describe, expect, it } from 'vitest';
import { emptyQueue, nextToProcess, queueReducer, queueSummary, type QueueAction, type QueueState } from './queue';

const run = (actions: QueueAction[], start: QueueState = emptyQueue()) => actions.reduce(queueReducer, start);
const add = (...ids: string[]): QueueAction => ({ type: 'add', items: ids.map((id) => ({ id, name: `${id}.jpg`, bytes: 100 })), model: 'fast' });

describe('queue', () => {
  it('adds items as queued and selects the first one', () => {
    const s = run([add('a', 'b')]);
    expect(s.items.map((i) => [i.id, i.status, i.model])).toEqual([
      ['a', 'queued', 'fast'],
      ['b', 'queued', 'fast'],
    ]);
    expect(s.selectedId).toBe('a');
    expect(run([add('a'), add('a')]).items).toHaveLength(1);
  });

  it('processes one at a time, in order', () => {
    let s = run([add('a', 'b', 'c')]);
    expect(nextToProcess(s)?.id).toBe('a');
    s = queueReducer(s, { type: 'start', id: 'a' });
    expect(nextToProcess(s)).toBeNull();
    s = queueReducer(s, { type: 'done', id: 'a', width: 10, height: 20, backend: 'wasm', ms: 5 });
    expect(s.items[0]).toMatchObject({ status: 'done', width: 10, height: 20, rev: 1 });
    expect(nextToProcess(s)?.id).toBe('b');
    s = run([{ type: 'start', id: 'b' }, { type: 'fail', id: 'b', error: 'boom' }], s);
    expect(s.items[1]).toMatchObject({ status: 'error', error: 'boom' });
    expect(nextToProcess(s)?.id).toBe('c');
    expect(queueSummary(s)).toEqual({ queued: 1, processing: 0, done: 1, error: 1, total: 3 });
  });

  it('ignores out-of-order transitions', () => {
    const s = run([add('a'), { type: 'done', id: 'a', width: 1, height: 1, backend: 'wasm', ms: 1 }, { type: 'fail', id: 'a', error: 'x' }]);
    expect(s.items[0].status).toBe('queued');
  });

  it('requeues errors and finished items with a new model, but never a running one', () => {
    let s = run([add('a', 'b'), { type: 'start', id: 'a' }, { type: 'fail', id: 'a', error: 'x' }, { type: 'start', id: 'b' }]);
    s = queueReducer(s, { type: 'requeue', ids: ['a', 'b'], model: 'portrait' });
    expect(s.items[0]).toMatchObject({ status: 'queued', model: 'portrait', error: undefined });
    expect(s.items[1]).toMatchObject({ status: 'processing', model: 'fast' });
    s = queueReducer(s, { type: 'interrupt', id: 'b' });
    expect(s.items[1].status).toBe('queued');
  });

  it('removing the selected item selects its neighbour', () => {
    let s = run([add('a', 'b', 'c'), { type: 'select', id: 'b' }]);
    s = queueReducer(s, { type: 'remove', id: 'b' });
    expect(s.selectedId).toBe('c');
    s = queueReducer(s, { type: 'remove', id: 'c' });
    expect(s.selectedId).toBe('a');
    s = queueReducer(s, { type: 'remove', id: 'a' });
    expect(s).toEqual(emptyQueue());
  });

  it('select ignores unknown ids; refine and touch update one item', () => {
    let s = run([add('a', 'b')]);
    expect(queueReducer(s, { type: 'select', id: 'zzz' })).toBe(s);
    s = run([{ type: 'refine', id: 'b', refine: { threshold: 0.7, softness: 0.2 } }, { type: 'touch', id: 'b' }], s);
    expect(s.items[1].refine).toEqual({ threshold: 0.7, softness: 0.2 });
    expect(s.items[1].rev).toBe(1);
    expect(s.items[0].rev).toBe(0);
  });

  it('clear empties everything', () => {
    expect(run([add('a'), { type: 'clear' }])).toEqual(emptyQueue());
  });
});
