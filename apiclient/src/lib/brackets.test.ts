import { describe, expect, it } from 'vitest';
import { bracketPairs } from './brackets';

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
