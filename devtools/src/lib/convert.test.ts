import { describe, expect, it } from 'vitest';
import { convertCase, splitWords } from './caseConvert';
import { contrastRatio, parseColor, rgbToOklch, toHex, toHslString, toOklchString, toRgbString, wcagLevel } from './color';
import { decodeEntities, encodeEntities } from './htmlEntities';
import { bitLength, formatBigInt, groupDigits, parseBigInt, twosComplement } from './numberBase';

describe('number base', () => {
  it('converts between bases', () => {
    expect(formatBigInt(parseBigInt('255', 10), 16)).toBe('ff');
    expect(formatBigInt(parseBigInt('0xFF', 16), 2)).toBe('11111111');
    expect(formatBigInt(parseBigInt('0b1010', 2), 8)).toBe('12');
    expect(formatBigInt(parseBigInt('777', 8), 10)).toBe('511');
    expect(formatBigInt(parseBigInt('zz', 36), 10)).toBe('1295');
    expect(formatBigInt(parseBigInt('-42', 10), 16, true)).toBe('-2A');
  });
  it('is BigInt-safe beyond 2^53', () => {
    const n = parseBigInt('123456789012345678901234567890', 10);
    expect(formatBigInt(n, 16)).toBe('18ee90ff6c373e0ee4e3f0ad2');
    expect(formatBigInt(parseBigInt('18ee90ff6c373e0ee4e3f0ad2', 16), 10)).toBe('123456789012345678901234567890');
    expect(formatBigInt(parseBigInt('ffffffffffffffff', 16), 10)).toBe('18446744073709551615');
  });
  it('accepts separators and rejects bad digits', () => {
    expect(parseBigInt('1_000_000', 10)).toBe(1000000n);
    expect(parseBigInt('1,000', 10)).toBe(1000n);
    expect(parseBigInt('dead beef', 16)).toBe(0xdeadbeefn);
    expect(() => parseBigInt('102', 2)).toThrow(/not a valid base-2 digit/);
    expect(() => parseBigInt('', 10)).toThrow();
    expect(() => parseBigInt('1', 37)).toThrow();
  });
  it('groups digits, bit length, two’s complement', () => {
    expect(groupDigits('11110000', 4)).toBe('1111 0000');
    expect(groupDigits('1234567', 3, ',')).toBe('1,234,567');
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(0n)).toBe(0);
    expect(twosComplement(-1n, 8)).toBe('11111111');
    expect(twosComplement(-128n, 8)).toBe('10000000');
    expect(twosComplement(-129n, 8)).toBeNull();
  });
});

describe('color', () => {
  it('parses hex forms', () => {
    expect(parseColor('#4f46e5')?.rgb).toEqual({ r: 79, g: 70, b: 229, a: 1 });
    expect(parseColor('fff')?.rgb).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0000ff80')?.rgb.a).toBeCloseTo(0.502, 3);
    expect(parseColor('#12')).toBeNull();
  });
  it('parses rgb/hsl in legacy and modern syntax', () => {
    expect(toHex(parseColor('rgb(79, 70, 229)')!.rgb)).toBe('#4f46e5');
    expect(toHex(parseColor('rgb(79 70 229 / 50%)')!.rgb)).toBe('#4f46e580');
    expect(toHex(parseColor('hsl(0, 100%, 50%)')!.rgb)).toBe('#ff0000');
    expect(toHex(parseColor('hsl(120deg 100% 25%)')!.rgb)).toBe('#008000');
    expect(toHex(parseColor('hsl(0.5turn 100% 50%)')!.rgb)).toBe('#00ffff');
    expect(toHex(parseColor('rebeccapurple')!.rgb)).toBe('#663399');
  });
  it('formats rgb/hsl', () => {
    const c = parseColor('#4f46e5')!.rgb;
    expect(toRgbString(c)).toBe('rgb(79, 70, 229)');
    expect(toHslString(c)).toBe('hsl(243.4, 75.4%, 58.6%)');
    expect(toRgbString({ ...c, a: 0.5 })).toBe('rgba(79, 70, 229, 0.5)');
  });
  it('converts to and from OKLCH', () => {
    const red = rgbToOklch({ r: 255, g: 0, b: 0, a: 1 });
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    const white = rgbToOklch({ r: 255, g: 255, b: 255, a: 1 });
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.c).toBeLessThan(1e-3);
    expect(toOklchString({ r: 255, g: 255, b: 255, a: 1 })).toBe('oklch(100% 0 0)');
    for (const hex of ['#4f46e5', '#123456', '#ff8800', '#000000', '#808080']) {
      expect(toHex(parseColor(toOklchString(parseColor(hex)!.rgb))!.rgb)).toBe(hex);
    }
    const out = parseColor('oklch(70% 0.4 150)')!;
    expect(out.inGamut).toBe(false);
    expect(parseColor('oklch(0.628 0.2577 29.23)')!.inGamut).toBe(true);
  });
  it('WCAG contrast', () => {
    const w = { r: 255, g: 255, b: 255, a: 1 };
    const k = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrastRatio(w, k)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor('#777777')!.rgb, w)).toBeCloseTo(4.48, 2);
    expect(wcagLevel(4.48)).toBe('Fail');
    expect(wcagLevel(4.48, true)).toBe('AA');
    expect(wcagLevel(7.1)).toBe('AAA');
  });
});

describe('case conversion', () => {
  it('splits words at boundaries and acronyms', () => {
    expect(splitWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    expect(splitWords('user_id-andName v2Update')).toEqual(['user', 'id', 'and', 'Name', 'v2', 'Update']);
    expect(splitWords('  ')).toEqual([]);
  });
  it('converts to every case', () => {
    const s = 'hello world-fooBar';
    expect(convertCase(s, 'camel')).toBe('helloWorldFooBar');
    expect(convertCase(s, 'pascal')).toBe('HelloWorldFooBar');
    expect(convertCase(s, 'snake')).toBe('hello_world_foo_bar');
    expect(convertCase(s, 'kebab')).toBe('hello-world-foo-bar');
    expect(convertCase(s, 'constant')).toBe('HELLO_WORLD_FOO_BAR');
    expect(convertCase(s, 'dot')).toBe('hello.world.foo.bar');
    expect(convertCase(s, 'path')).toBe('hello/world/foo/bar');
    expect(convertCase(s, 'title')).toBe('Hello World Foo Bar');
    expect(convertCase(s, 'sentence')).toBe('Hello world foo bar');
    expect(convertCase(s, 'upper')).toBe('HELLO WORLD FOO BAR');
  });
  it('converts each line separately and handles unicode', () => {
    expect(convertCase('firstName\nlast_name', 'kebab')).toBe('first-name\nlast-name');
    expect(convertCase('größe Ändern', 'camel')).toBe('größeÄndern');
  });
});

describe('HTML entities', () => {
  it('encodes the special characters', () => {
    expect(encodeEntities(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    expect(encodeEntities('café 👋', true)).toBe('caf&#xE9; &#x1F44B;');
    expect(encodeEntities('café')).toBe('café');
  });
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('&lt;p&gt;&amp;&quot;&#39;&nbsp;&copy;&#x1F44B;&#128075;')).toBe('<p>&"\' ©👋👋');
    expect(decodeEntities('&unknown; &amp')).toBe('&unknown; &amp');
    expect(decodeEntities('&unknown;', (e) => (e === '&unknown;' ? '?' : null))).toBe('?');
    expect(decodeEntities('&#0;&#xD800;')).toBe('��');
  });
  it('round-trips', () => {
    const s = `<script>alert("x & y")</script> ünïcödé`;
    expect(decodeEntities(encodeEntities(s, true))).toBe(s);
  });
});
