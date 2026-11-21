import { describe, expect, it } from 'vitest';
import { bracketPairs, newlineIndex } from './brackets';

describe('bracketPairs', () => {
  it('pairs multi-line brackets and skips placeholders, strings and comments', () => {
    const text = '{\n  "id": {{destinationId}},\n  "s": "{ not [ a bracket",\n  // { comment\n  "list": [\n    1\n  ]\n}';
    const pairs = bracketPairs(text);
    expect(pairs.map((p) => [text[p.open], text[p.close]])).toEqual([
      ['{', '}'],
      ['[', ']'],
    ]);
    expect(pairs[0]).toEqual({ open: 0, close: text.length - 1 });
  });

  it('can include single-line pairs (for bracket matching); placeholder braces never pair', () => {
    expect(bracketPairs('{"a": [1, {{x}}]}', { singleLine: true })).toEqual([
      { open: 0, close: 16 },
      { open: 6, close: 15 },
    ]);
  });

  it('ignores single-line pairs and tolerates stray closers', () => {
    expect(bracketPairs('{"a": [1, 2]}')).toEqual([]);
    expect(bracketPairs('] {\n}')).toEqual([{ open: 2, close: 4 }]);
  });
});

describe('bracketPairs on long single-line text', () => {
  it('stays linear on minified JSON (no per-bracket newline scan)', () => {
    const minified = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, tags: ['a', 'b'], nested: { x: [i] } })));
    const started = performance.now();
    const pairs = bracketPairs(minified);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(pairs).toEqual([]); // nothing spans lines, so nothing folds
    expect(bracketPairs(minified, { singleLine: true }).length).toBe(1 + 20000 * 4);
  });

  it('newlineIndex answers "is there a line break between"', () => {
    const has = newlineIndex('ab\ncd\n');
    expect(has(0, 2)).toBe(false);
    expect(has(0, 3)).toBe(true);
    expect(has(2, 5)).toBe(false); // the break at 2 is not strictly inside
    expect(has(3, 6)).toBe(true);
  });
});
