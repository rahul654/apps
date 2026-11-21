import { describe, expect, it } from 'vitest';
import { canonical, diffJson, normalizedText, summarize } from './jsondiff';

describe('json diff', () => {
  it('finds added, removed and changed leaves with paths', () => {
    const d = diffJson({ a: 1, b: { c: [1, 2], d: 'x' }, gone: true }, { a: 2, b: { c: [1, 2, 3], d: 'x' }, added: null });
    expect(d).toEqual([
      { path: '$.a', kind: 'changed', before: 1, after: 2 },
      { path: '$.b.c[2]', kind: 'added', after: 3 },
      { path: '$.gone', kind: 'removed', before: true },
      { path: '$.added', kind: 'added', after: null },
    ]);
    expect(summarize(d)).toEqual({ added: 2, removed: 1, changed: 1 });
  });
  it('treats type changes and array shrink', () => {
    expect(diffJson([1, 2, 3], [1, 2])).toEqual([{ path: '$[2]', kind: 'removed', before: 3 }]);
    expect(diffJson({ a: [1] }, { a: { 0: 1 } })).toEqual([{ path: '$.a', kind: 'changed', before: [1], after: { 0: 1 } }]);
    expect(diffJson('a', 'a')).toEqual([]);
  });
  it('ignores keys by name or path', () => {
    expect(diffJson({ id: 1, ts: 'a', n: { id: 2, v: 1 } }, { id: 9, ts: 'b', n: { id: 3, v: 1 } }, { ignoreKeys: ['id', 'ts'] })).toEqual([]);
    expect(diffJson({ id: 1, n: { id: 2 } }, { id: 9, n: { id: 3 } }, { ignoreKeys: ['n.id'] })).toEqual([{ path: '$.id', kind: 'changed', before: 1, after: 9 }]);
  });
  it('ignores array order when asked, pairing leftovers', () => {
    expect(diffJson({ a: [1, 2, 3] }, { a: [3, 1, 2] }, { ignoreOrder: true })).toEqual([]);
    expect(diffJson({ a: [{ id: 1 }, { id: 2 }] }, { a: [{ id: 2 }, { id: 1 }] }, { ignoreOrder: true })).toEqual([]);
    expect(diffJson({ a: [{ id: 1, v: 'x' }, { id: 2 }] }, { a: [{ id: 2 }, { id: 1, v: 'y' }] }, { ignoreOrder: true })).toEqual([{ path: '$.a[~0].v', kind: 'changed', before: 'x', after: 'y' }]);
    expect(diffJson([1], [1, 2], { ignoreOrder: true })).toEqual([{ path: '$[~0]', kind: 'added', after: 2 }]);
    expect(diffJson({ a: [1, 2, 3] }, { a: [3, 1, 2] })).toHaveLength(3);
  });
  it('canonical / normalizedText sort keys (and arrays with ignoreOrder)', () => {
    expect(canonical({ b: 1, a: [2, { z: 1, y: 2 }] })).toBe('{"a":[2,{"y":2,"z":1}],"b":1}');
    expect(normalizedText({ b: [2, 1], a: 1 }, { ignoreOrder: true })).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(normalizedText({ b: [2, 1], a: 1 })).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    1\n  ]\n}');
  });
});
