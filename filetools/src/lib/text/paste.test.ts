// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mapFontFamily, pastedFromPlainText, sanitizePastedHtml } from './paste';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const simple = (html: string) => sanitizePastedHtml(html, parse).map((p) => p.map((r) => [r.text, r.bold, r.italic, r.underline, r.strike, r.font ?? null]));

describe('paste sanitiser', () => {
  it('keeps bold, italic, underline and strike from tags and styles', () => {
    expect(simple('<p>a <b>b</b> <i>c</i> <u>d</u> <s>e</s> <span style="font-weight:700;font-style:italic">f</span></p>')).toEqual([
      [
        ['a ', false, false, false, false, null],
        ['b', true, false, false, false, null],
        [' ', false, false, false, false, null],
        ['c', false, true, false, false, null],
        [' ', false, false, false, false, null],
        ['d', false, false, true, false, null],
        [' ', false, false, false, false, null],
        ['e', false, false, false, true, null],
        [' ', false, false, false, false, null],
        ['f', true, true, false, false, null],
      ],
    ]);
  });

  it('respects explicit font-weight:normal (Google Docs wraps content in <b>)', () => {
    expect(simple('<b style="font-weight:normal"><span>plain</span><span style="font-weight:700">bold</span></b>')).toEqual([
      [['plain', false, false, false, false, null], ['bold', true, false, false, false, null]],
    ]);
  });

  it('turns blocks into paragraphs and <br> into line breaks', () => {
    expect(sanitizePastedHtml('<div>one<br>two</div><p>three</p><ul><li>four</li><li>five</li></ul>', parse).map((p) => p.map((r) => r.text).join(''))).toEqual(['one\ntwo', 'three', 'four', 'five']);
  });

  it('drops colours, sizes, links, images, scripts and styles but keeps their text', () => {
    const out = sanitizePastedHtml('<style>p{color:red}</style><script>alert(1)</script><p style="color:red;font-size:40px"><a href="https://x.y">link</a><img src="x.png">!</p>', parse);
    expect(out).toEqual([[{ text: 'link!', bold: false, italic: false, underline: false, strike: false, font: undefined }]]);
  });

  it('collapses whitespace and maps fonts with obvious matches', () => {
    expect(simple('<p style="font-family: \'Times New Roman\', serif">  many    spaces  </p><p style="font-family: Comic Sans MS">x</p>')).toEqual([
      [['many spaces', false, false, false, false, 'Times']],
      [['x', false, false, false, false, null]],
    ]);
    expect(mapFontFamily('"Noto Sans Mono", monospace')).toBe('NotoSansMono');
    expect(mapFontFamily('Arial')).toBe('Helvetica');
    expect(mapFontFamily('Wingdings')).toBeUndefined();
  });

  it('plain text paste splits lines into paragraphs', () => {
    expect(pastedFromPlainText('a\r\nb\n\nc').map((p) => p.map((r) => r.text).join(''))).toEqual(['a', 'b', '', 'c']);
  });
});
