import { describe, expect, it } from 'vitest';
import { lineCol, prettifyJsonText, significantTokens, tokenizeJson, validateJsonText } from './jsonText';

describe('tokenizeJson', () => {
  it('keeps placeholders in non-string positions as one word, and inside strings as part of the string', () => {
    const t = tokenizeJson('{"id": {{destinationId}}, "name": "a{{b}}c", "list": [{{x}}{{y}}, -{{n}}]}').tokens;
    expect(t.filter((x) => x.type === 'word').map((x) => x.text)).toEqual(['{{destinationId}}', '{{x}}{{y}}', '-{{n}}']);
    expect(t.filter((x) => x.type === 'string').map((x) => x.text)).toEqual(['"id"', '"name"', '"a{{b}}c"', '"list"']);
  });

  it('a placeholder as the first thing inside an object or array is still a placeholder', () => {
    expect(significantTokens('[{{a}}]')).toEqual(['[', '{{a}}', ']']);
    expect(significantTokens('{ {{k}}: 1 }')).toEqual(['{', '{{k}}', ':', '1', '}']);
    expect(significantTokens('[{"a":1}]')).toEqual(['[', '{', '"a"', ':', '1', '}', ']']);
  });

  it('handles escaped quotes, comments and reports unterminated strings', () => {
    expect(significantTokens('"a\\"b" // c\n/* d */ 1')).toEqual(['"a\\"b"', '// c', '/* d */', '1']);
    expect(tokenizeJson('{"a": "oops\n}').error).toMatchObject({ message: 'Unterminated string', line: 1, col: 7 });
  });
});

describe('validateJsonText', () => {
  it('accepts JSON with placeholders and comments, and empty text', () => {
    expect(validateJsonText('')).toBeNull();
    expect(validateJsonText('  \n ')).toBeNull();
    expect(validateJsonText('{"id": {{destinationId}}, "n": 1.5e3, "ok": true, "x": null, "s": "{{s}}"}')).toBeNull();
    expect(validateJsonText('{\n  // the target\n  "id": {{id}} /* inline */\n}')).toBeNull();
    expect(validateJsonText('[1, [2, {}], {"a": []}]')).toBeNull();
  });

  it('reports the line and column of the first error', () => {
    expect(validateJsonText('{\n  "a": 1\n  "b": 2\n}')).toMatchObject({ line: 3, col: 3, message: "Expected ',' or '}', found string" });
    expect(validateJsonText('{"a": 1,}')).toMatchObject({ message: 'Trailing comma before }' });
    expect(validateJsonText('[1, 2,]')).toMatchObject({ message: 'Trailing comma before ]' });
    expect(validateJsonText('{"a": tru}')).toMatchObject({ message: "Invalid value 'tru'", col: 7 });
    expect(validateJsonText('{a: 1}')).toMatchObject({ message: "Expected a property name in double quotes, found 'a'" });
    expect(validateJsonText('{"a": 1')).toMatchObject({ message: 'Unexpected end of JSON' });
    expect(validateJsonText('{} {}')).toMatchObject({ message: "Expected end of JSON, found '{'", col: 4 });
    expect(validateJsonText('{"a": 01}')).toMatchObject({ message: "Invalid value '01'" });
  });

  it('lineCol is 1-based', () => {
    expect(lineCol('ab\ncd', 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
  });
});

describe('prettifyJsonText', () => {
  it('re-indents around placeholders without changing them', () => {
    const src = '{"destinationId":{{destinationId}},"tags":[{{tag1}},"{{tag2}}"],"nested":{"n":{{n}}},"empty":{},"none":[]}';
    const r = prettifyJsonText(src);
    expect(r.error).toBeNull();
    expect(r.text).toBe(
      ['{', '  "destinationId": {{destinationId}},', '  "tags": [', '    {{tag1}},', '    "{{tag2}}"', '  ],', '  "nested": {', '    "n": {{n}}', '  },', '  "empty": {},', '  "none": []', '}'].join('\n'),
    );
    // Only whitespace changed: the token sequence is identical.
    expect(significantTokens(r.text!)).toEqual(significantTokens(src));
    // Idempotent.
    expect(prettifyJsonText(r.text!).text).toBe(r.text);
  });

  it('keeps numbers exactly as written (no float or big-int rounding) and honours the indent', () => {
    const r = prettifyJsonText('{"big":12345678901234567890,"f":1.50}', 4);
    expect(r.text).toBe('{\n    "big": 12345678901234567890,\n    "f": 1.50\n}');
  });

  it('keeps comments, trailing ones on their line', () => {
    const r = prettifyJsonText('{"a": 1, // first\n"b": {{b}} /* why */}');
    expect(r.text).toBe('{\n  "a": 1, // first\n  "b": {{b}} /* why */\n}');
    expect(significantTokens(r.text!)).toEqual(significantTokens('{"a": 1, // first\n"b": {{b}} /* why */}'));
  });

  it('leaves invalid JSON alone and returns the error', () => {
    const r = prettifyJsonText('{"a": 1 "b": 2}');
    expect(r.text).toBeNull();
    expect(r.error).toMatchObject({ line: 1, col: 9 });
  });

  it('a top-level scalar or placeholder is returned as is', () => {
    expect(prettifyJsonText(' {{body}} ').text).toBe('{{body}}');
    expect(prettifyJsonText('"x"').text).toBe('"x"');
  });
});
