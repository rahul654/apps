import { describe, expect, it } from 'vitest';
import { childPath, diffJson, diffReport, formatJson, lineColumn, minifyJson, parseJson, sortKeysDeep } from './json';

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":[1,2,{"b":null}]}')).toEqual({ ok: true, value: { a: [1, 2, { b: null }] } });
  });

  it('reports line and column of a missing comma', () => {
    const r = parseJson('{\n  "a": 1\n  "b": 2\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBe(3);
      expect(r.error.message).toMatch(/Expected ',' or '}'/);
    }
  });

  it('reports trailing commas, single quotes and unterminated strings', () => {
    const t = parseJson('[1, 2,]');
    expect(!t.ok && t.error.message).toMatch(/Trailing comma/);
    expect(!t.ok && t.error.column).toBe(7);
    const q = parseJson("{'a': 1}");
    expect(!q.ok && q.error.message).toMatch(/double-quoted property name/);
    const u = parseJson('{"a": "abc');
    expect(!u.ok && u.error).toMatchObject({ message: 'Unterminated string', line: 1, column: 7 });
  });

  it('reports unexpected trailing data and empty input', () => {
    const r = parseJson('{"a":1} x');
    expect(!r.ok && r.error.message).toMatch(/after the end/);
    expect(!r.ok && r.error.column).toBe(9);
    const e = parseJson('   ');
    expect(!e.ok && e.error.message).toBe('Input is empty');
  });

  it('flags bad escapes, control characters and invalid numbers', () => {
    expect(parseJson('"\\x"').ok).toBe(false);
    expect(parseJson('"a\tb"').ok).toBe(false);
    const n = parseJson('[01]');
    expect(!n.ok && n.error.column).toBe(3);
    const lit = parseJson('[tru]');
    expect(!lit.ok && lit.error.column).toBe(2);
  });

  it('lineColumn is 1-based', () => {
    expect(lineColumn('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
});

describe('format / minify / sort', () => {
  const v = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: true } };
  it('formats with indent options', () => {
    expect(formatJson({ a: 1 }, 2)).toBe('{\n  "a": 1\n}');
    expect(formatJson({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
    expect(formatJson({ a: 1 }, 'tab')).toBe('{\n\t"a": 1\n}');
  });
  it('sorts keys deeply without reordering arrays', () => {
    expect(minifyJson(v, true)).toBe('{"a":{"c":true,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(minifyJson(v)).toBe('{"b":1,"a":{"d":[3,{"z":1,"y":2}],"c":true}}');
  });
  it('keeps __proto__ as data when sorting', () => {
    const parsed = JSON.parse('{"__proto__": {"x": 1}, "a": 2}');
    const sorted = sortKeysDeep(parsed) as Record<string, unknown>;
    expect(Object.keys(sorted)).toEqual(['__proto__', 'a']);
    expect(minifyJson(sorted)).toBe('{"__proto__":{"x":1},"a":2}');
  });
});

describe('diffJson', () => {
  it('returns nothing for equal values', () => {
    expect(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }).entries).toEqual([]);
  });

  it('lists added, removed and changed paths', () => {
    const a = { name: 'x', tags: ['a', 'b'], nested: { keep: 1, drop: true }, n: 1 };
    const b = { name: 'y', tags: ['a', 'b', 'c'], nested: { keep: 1, add: null }, n: '1' };
    const { entries } = diffJson(a, b);
    expect(entries).toEqual([
      { path: '$.name', kind: 'changed', before: 'x', after: 'y' },
      { path: '$.tags[2]', kind: 'added', after: 'c' },
      { path: '$.nested.drop', kind: 'removed', before: true },
      { path: '$.nested.add', kind: 'added', after: null },
      { path: '$.n', kind: 'changed', before: 1, after: '1' },
    ]);
  });

  it('treats type changes (object vs array) as changed', () => {
    expect(diffJson({ a: [] }, { a: {} }).entries).toEqual([{ path: '$.a', kind: 'changed', before: [], after: {} }]);
    expect(diffJson(null, {}).entries).toHaveLength(1);
  });

  it('quotes non-identifier keys in paths', () => {
    expect(childPath('$', 'a b')).toBe('$["a b"]');
    expect(childPath('$', 'ok_1')).toBe('$.ok_1');
    expect(childPath('$.x', 3)).toBe('$.x[3]');
  });

  it('caps the number of entries', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = a.map((x) => x + 1);
    const r = diffJson(a, b, 10);
    expect(r.entries).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('produces a text report', () => {
    const { entries } = diffJson({ a: 1, b: 2 }, { a: 2, c: 3 });
    expect(diffReport(entries)).toBe('~ $.a: 1 → 2\n- $.b: 2\n+ $.c: 3');
  });
});
