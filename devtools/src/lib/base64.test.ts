import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeBase64Text, encodeTextBase64, parseDataUrl, sniffMime, toDataUrl } from './base64';

describe('base64', () => {
  it('encodes ASCII like btoa', () => {
    expect(encodeTextBase64('hello world')).toBe('aGVsbG8gd29ybGQ=');
    expect(encodeTextBase64('')).toBe('');
  });

  it('round-trips UTF-8 (accents, CJK, emoji)', () => {
    for (const s of ['héllo wörld', '日本語テキスト', '👋🏽 family: 👨‍👩‍👧‍👦', 'ä€𝄞', 'a\u0000b']) {
      const enc = encodeTextBase64(s);
      expect(decodeBase64Text(enc).text).toBe(s);
      expect(decodeBase64Text(encodeTextBase64(s, true)).text).toBe(s);
    }
    expect(encodeTextBase64('€')).toBe('4oKs');
  });

  it('URL-safe variant uses -_ and drops padding', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00]);
    expect(bytesToBase64(bytes)).toBe('+/+/AA==');
    expect(bytesToBase64(bytes, true)).toBe('-_-_AA');
    expect([...base64ToBytes('-_-_AA')]).toEqual([...bytes]);
  });

  it('tolerates whitespace and missing padding, rejects garbage', () => {
    expect(decodeBase64Text('aGVs\nbG8g d29y bGQ').text).toBe('hello world');
    expect(() => base64ToBytes('abc$')).toThrow(/Invalid character/);
    expect(() => base64ToBytes('abcde')).toThrow(/length/);
    expect(() => base64ToBytes('ab=c')).toThrow();
  });

  it('flags binary (non UTF-8) output', () => {
    const r = decodeBase64Text(bytesToBase64(new Uint8Array([0xff, 0xfe, 0x00])));
    expect(r.text).toBeNull();
    expect(r.bytes.length).toBe(3);
  });

  it('handles large inputs (chunked encoding)', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect([...base64ToBytes(bytesToBase64(big))]).toEqual([...big]);
  });

  it('parses data URLs and sniffs types', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const url = toDataUrl(png, 'image/png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const d = parseDataUrl(url)!;
    expect(d.mime).toBe('image/png');
    expect(d.isBase64).toBe(true);
    expect(sniffMime(decodeBase64Text(url).bytes)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffMime(new TextEncoder().encode('{"a":1}'))?.ext).toBe('json');
    expect(parseDataUrl('not a data url')).toBeNull();
  });
});
