import { describe, expect, it } from 'vitest';
import { resolveVariant } from '../fonts/registry';
import { layoutText, mergeFragments, STRIKE_OFFSET, UNDERLINE_OFFSET, type MeasureCtx } from './layout';
import {
  clearFormatting,
  commonMarks,
  DEFAULT_MARKS,
  makeParagraph,
  normalizeRuns,
  plainText,
  rangeHasMark,
  scaleSizes,
  setMarks,
  setParagraphProps,
  splitRunsAt,
  toggleMark,
  type Paragraph,
  type RunMarks,
} from './model';
import { analyzeText, baseDirection, isEmojiChar } from './scripts';
import { applyStrategyFonts, chooseStrategy, type CoverageFn } from './strategy';

/** Fake metrics: every character is 0.5em wide; ascent 0.8em, descent 0.2em. */
const mono: MeasureCtx = {
  width: (t, m) => [...t].length * m.size * 0.5,
  metrics: (m) => ({ ascent: m.size * 0.8, descent: m.size * 0.2 }),
};
const M = (patch: Partial<RunMarks> = {}): RunMarks => ({ ...DEFAULT_MARKS, size: 10, ...patch });
const para = (runs: [string, Partial<RunMarks>?][], align: Paragraph['align'] = 'left', lineHeight = 1): Paragraph => ({
  runs: runs.map(([text, m]) => ({ text, marks: M(m) })),
  align,
  lineHeight,
});
const lineTexts = (l: ReturnType<typeof layoutText>) => l.lines.map((ln) => ln.fragments.map((f) => f.text).join(''));

describe('layout: wrapping', () => {
  it('wraps at spaces and drops the space at the break', () => {
    // width 100, char = 5pt → 20 chars per line
    const l = layoutText([para([['aaaa bbbb cccc dddd eeee ffff']])], { width: 100, padding: 0 }, mono);
    expect(lineTexts(l)).toEqual(['aaaa bbbb cccc dddd', 'eeee ffff']);
    expect(l.lines[0].contentWidth).toBe(95);
  });

  it('keeps mixed runs inside one word together and measures each run', () => {
    const l = layoutText([para([['Hel'], ['lo', { bold: true }], [' world']])], { width: 30, padding: 0 }, mono);
    expect(lineTexts(l)).toEqual(['Hello', 'world']);
    expect(l.lines[0].fragments.map((f) => [f.text, f.x, f.marks.bold])).toEqual([['Hel', 0, false], ['lo', 15, true]]);
  });

  it('uses the largest font size on a line for its height and baseline', () => {
    const l = layoutText([para([['small '], ['BIG', { size: 20 }]], 'left', 1.5)], { width: 500, padding: 0 }, mono);
    const ln = l.lines[0];
    expect(ln.height).toBe(30); // 20 × 1.5
    // baseline = top + (30 − (16 + 4)) / 2 + 16
    expect(ln.baseline).toBe(21);
    expect(l.height).toBe(30);
  });

  it('breaks words longer than the line', () => {
    const l = layoutText([para([['abcdefghij']])], { width: 20, padding: 0 }, mono); // 4 chars per line
    expect(lineTexts(l)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('honours explicit line breaks and empty paragraphs', () => {
    const l = layoutText([para([['one\ntwo']]), para([['']]), para([['three']])], { width: 500, padding: 0 }, mono);
    expect(lineTexts(l)).toEqual(['one', 'two', '', 'three']);
    expect(l.lines.map((x) => x.paragraph)).toEqual([0, 0, 1, 2]);
    expect(l.height).toBe(40);
  });

  it('applies line height multipliers and padding', () => {
    const l = layoutText([para([['a\nb']], 'left', 2)], { width: 100, padding: 5 }, mono);
    expect(l.lines.map((x) => x.top)).toEqual([5, 25]);
    expect(l.height).toBe(50);
    expect(l.lines[0].fragments[0].x).toBe(5);
  });

  it('breaks CJK text between characters', () => {
    const l = layoutText([para([['日本語のテキスト']])], { width: 20, padding: 0 }, mono); // 4 chars per line
    expect(lineTexts(l)).toEqual(['日本語の', 'テキスト']);
  });
});

describe('layout: alignment', () => {
  const text = 'aa bb cc dd ee'; // 14 chars → 70pt
  it('left, center, right', () => {
    const x = (align: Paragraph['align']) => layoutText([para([[text]], align)], { width: 100, padding: 0 }, mono).lines[0].fragments[0].x;
    expect(x('left')).toBe(0);
    expect(x('center')).toBe(15);
    expect(x('right')).toBe(30);
  });

  it('justify stretches inner spaces, but not the last line', () => {
    const l = layoutText([para([['aaaa bb cc dddddddddd ee']], 'justify')], { width: 70, padding: 0 }, mono);
    expect(lineTexts(l)).toEqual(['aaaa bb cc', 'dddddddddd ee']);
    const first = l.lines[0].fragments;
    const last = first[first.length - 1];
    expect(last.x + last.width).toBeCloseTo(70); // filled to the edge
    expect(first.filter((f) => f.space).every((f) => !f.natural)).toBe(true);
    // Last line: natural spacing, left aligned.
    expect(l.lines[1].fragments[0].x).toBe(0);
    expect(l.lines[1].fragments.every((f) => f.natural)).toBe(true);
  });

  it("doesn't justify lines that end with an explicit break", () => {
    const l = layoutText([para([['aa bb\ncc dd']], 'justify')], { width: 100, padding: 0 }, mono);
    expect(l.lines[0].fragments.every((f) => f.natural)).toBe(true);
  });

  it('start alignment follows paragraph direction (RTL → right)', () => {
    const rtl = layoutText([para([['שלום עולם']], 'start')], { width: 100, padding: 0 }, mono);
    const right = rtl.lines[0].fragments.reduce((m, f) => Math.max(m, f.x + f.width), 0);
    expect(right).toBeCloseTo(100);
    expect(rtl.lines[0].fragments.every((f) => f.rtl || f.space)).toBe(true);
    // Visual order: first logical word ends up rightmost.
    const words = rtl.lines[0].fragments.filter((f) => !f.space);
    expect(words[words.length - 1].text).toBe('שלום');
  });

  it('keeps an English phrase left-to-right inside an RTL paragraph', () => {
    const l = layoutText([para([['שלום big world עולם']], 'start')], { width: 500, padding: 0 }, mono);
    const words = l.lines[0].fragments.filter((f) => !f.space).map((f) => f.text);
    expect(words).toEqual(['עולם', 'big', 'world', 'שלום']);
  });
});

describe('layout: decorations', () => {
  it('computes underline, strike and highlight geometry and merges adjacent ones', () => {
    const l = layoutText([para([['ab ', { underline: true, highlight: '#ffff00' }], ['cd', { underline: true, strike: true }]])], { width: 500, padding: 0 }, mono);
    const ul = l.decorations.filter((d) => d.kind === 'underline');
    expect(ul).toHaveLength(1); // ab + space + cd merged
    expect(ul[0]).toMatchObject({ x: 0, w: 25, y: l.lines[0].baseline + 10 * UNDERLINE_OFFSET });
    const hl = l.decorations.find((d) => d.kind === 'highlight')!;
    expect(hl).toMatchObject({ x: 0, w: 15, y: l.lines[0].baseline - 8, h: 10, color: '#ffff00' });
    const st = l.decorations.find((d) => d.kind === 'strike')!;
    expect(st).toMatchObject({ x: 15, w: 10, y: l.lines[0].baseline - 10 * STRIKE_OFFSET });
    expect(l.decorations[0].kind).toBe('highlight'); // painted first
  });

  it('merges same-style fragments for PDF output', () => {
    const l = layoutText([para([['hello big world']])], { width: 500, padding: 0 }, mono);
    expect(mergeFragments(l.fragments).map((f) => f.text)).toEqual(['hello big world']);
    const j = layoutText([para([['aaaa bb cc dddddddddd ee']], 'justify')], { width: 70, padding: 0 }, mono);
    expect(mergeFragments(j.fragments.filter((f) => f.line === 0)).map((f) => f.text)).toEqual(['aaaa', 'bb', 'cc']);
  });
});

describe('mark operations', () => {
  const base = () => [para([['Hello world']]), para([['Second']])];

  it('splits runs at offsets', () => {
    expect(splitRunsAt([{ text: 'abcd', marks: M() }], 2).map((r) => r.text)).toEqual(['ab', 'cd']);
  });

  it('sets marks over a range, splitting runs', () => {
    const out = setMarks(base(), { start: 6, end: 11 }, { bold: true });
    expect(out[0].runs.map((r) => [r.text, r.marks.bold])).toEqual([['Hello ', false], ['world', true]]);
    expect(out[1].runs[0].marks.bold).toBe(false);
  });

  it('applies across paragraphs (global offsets count the paragraph break)', () => {
    const out = setMarks(base(), { start: 9, end: 15 }, { italic: true });
    expect(out[0].runs.map((r) => [r.text, r.marks.italic])).toEqual([['Hello wor', false], ['ld', true]]);
    expect(out[1].runs.map((r) => [r.text, r.marks.italic])).toEqual([['Sec', true], ['ond', false]]);
  });

  it('toggles: on when partly set, off when fully set', () => {
    const partly = setMarks(base(), { start: 0, end: 5 }, { bold: true });
    const on = toggleMark(partly, { start: 0, end: 11 }, 'bold');
    expect(rangeHasMark(on, { start: 0, end: 11 }, 'bold')).toBe(true);
    expect(on[0].runs).toHaveLength(1); // merged back into one run
    const off = toggleMark(on, { start: 0, end: 11 }, 'bold');
    expect(rangeHasMark(off, { start: 0, end: 11 }, 'bold')).toBe(false);
  });

  it('merges adjacent equal runs and keeps one run for empty paragraphs', () => {
    expect(normalizeRuns([{ text: 'a', marks: M() }, { text: 'b', marks: M() }, { text: '', marks: M({ bold: true }) }]).map((r) => r.text)).toEqual(['ab']);
    expect(normalizeRuns([{ text: '', marks: M({ size: 30 }) }])).toEqual([{ text: '', marks: M({ size: 30 }) }]);
  });

  it('clears formatting to defaults', () => {
    const styled = setMarks(base(), null, { bold: true, underline: true, color: '#ff0000', highlight: '#ffff00', font: 'NotoSerif', size: 30 });
    const out = clearFormatting(styled, { start: 0, end: 5 }, M());
    expect(out[0].runs[0]).toEqual({ text: 'Hello', marks: M() });
    expect(out[0].runs[1].marks).toMatchObject({ bold: true, size: 30 });
  });

  it('box-level ops: whole-box marks, paragraph props, size scaling, common marks', () => {
    const all = setMarks(base(), null, { color: '#00ff00' });
    expect(all.every((p) => p.runs.every((r) => r.marks.color === '#00ff00'))).toBe(true);
    expect(setParagraphProps(base(), { align: 'center', lineHeight: 2 }).every((p) => p.align === 'center' && p.lineHeight === 2)).toBe(true);
    expect(scaleSizes(base(), 2)[0].runs[0].marks.size).toBe(20);
    const mixed = setMarks(base(), { start: 0, end: 5 }, { bold: true });
    expect(commonMarks(mixed, null).bold).toBeUndefined();
    expect(commonMarks(mixed, null).size).toBe(10);
    expect(plainText(mixed)).toBe('Hello world\nSecond');
  });
});

describe('scripts', () => {
  it('detects complex scripts, emoji and direction', () => {
    expect(analyzeText('Hello Привет Ωμέγα Tiếng Việt').complex).toEqual([]);
    expect(analyzeText('नमस्ते').complex).toEqual(['Devanagari']);
    expect(analyzeText('مرحبا').rtl).toBe(true);
    expect(analyzeText('漢字かな한글').complex).toEqual(['Chinese', 'Japanese', 'Korean']);
    expect(analyzeText('ok 👍').emoji).toBe(true);
    expect(isEmojiChar('©')).toBe(false); // WinAnsi pictograph
    expect(analyzeText('é').combining).toBe(false); // NFC → é
    expect(analyzeText('q́').combining).toBe(true); // no precomposed form
    expect(baseDirection('123 שלום abc')).toBe('rtl');
    expect(baseDirection('abc שלום')).toBe('ltr');
  });
});

describe('save strategy', () => {
  // Coverage like our bundled Noto fonts: Latin, Cyrillic, Greek, Vietnamese — no Devanagari/Arabic/CJK.
  const noto: CoverageFn = (font, _v, cp) => {
    const ch = String.fromCodePoint(cp);
    if (font === 'DancingScript') return /[\p{Script=Latin}\p{P}\p{N}\p{S}]/u.test(ch);
    return /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{P}\p{N}\p{S}]/u.test(ch);
  };
  const box = (text: string, font: RunMarks['font'] = 'Helvetica') => [makeParagraph(text, M({ font }))];

  it('WinAnsi in standard fonts → vector, standard fonts', () => {
    const s = chooseStrategy(box('Café — “quotes” €5'), noto);
    expect(s).toMatchObject({ kind: 'vector', embedded: false, substitutions: [] });
  });

  it('Cyrillic in Helvetica → vector with Noto Sans substituted', () => {
    const p = box('Привет');
    const s = chooseStrategy(p, noto);
    expect(s).toMatchObject({ kind: 'vector', embedded: true, substitutions: [{ from: 'Helvetica', to: 'NotoSans' }] });
    expect(applyStrategyFonts(p, s)[0].runs[0].marks.font).toBe('NotoSans');
    expect(chooseStrategy(box('Привет', 'Times'), noto)).toMatchObject({ substitutions: [{ from: 'Times', to: 'NotoSerif' }] });
  });

  it('Vietnamese (also when typed decomposed) → vector', () => {
    expect(chooseStrategy(box('Tiếng Việt', 'NotoSans'), noto).kind).toBe('vector');
    expect(chooseStrategy(box('Tiếng Việt', 'NotoSans'), noto).kind).toBe('vector');
  });

  it('Hindi, Arabic, CJK, emoji → raster', () => {
    expect(chooseStrategy(box('नमस्ते दुनिया'), noto)).toMatchObject({ kind: 'raster', reason: 'complex-script', detail: 'Devanagari' });
    expect(chooseStrategy(box('مرحبا', 'NotoSans'), noto)).toMatchObject({ kind: 'raster', detail: 'Arabic' });
    expect(chooseStrategy(box('中文'), noto)).toMatchObject({ kind: 'raster', detail: 'Chinese' });
    expect(chooseStrategy(box('Great job 🎉'), noto)).toMatchObject({ kind: 'raster', reason: 'emoji' });
  });

  it('glyph missing from the chosen bundled font → raster', () => {
    expect(chooseStrategy(box('Привет', 'DancingScript'), noto)).toMatchObject({ kind: 'raster', reason: 'missing-glyphs' });
  });

  it('mixed box: standard Latin run + Cyrillic run → vector, only the Cyrillic run substituted', () => {
    const p: Paragraph[] = [{ runs: [{ text: 'Hello ', marks: M() }, { text: 'мир', marks: M({ bold: true }) }], align: 'start', lineHeight: 1.15 }];
    const s = chooseStrategy(p, noto);
    expect(s.kind === 'vector' && s.fonts).toEqual([['Helvetica', 'NotoSans']]);
    const mixedComplex: Paragraph[] = [{ runs: [{ text: 'Hello ', marks: M() }, { text: 'नमस्ते', marks: M() }], align: 'start', lineHeight: 1.15 }];
    expect(chooseStrategy(mixedComplex, noto).kind).toBe('raster');
  });

  it('variant fallback for families without italics', () => {
    expect(resolveVariant('Caveat', true, true)).toEqual({ key: 'bold', bold: true, italic: false, missing: ['italic'] });
    expect(resolveVariant('NotoSans', true, true).key).toBe('boldItalic');
    expect(resolveVariant('Helvetica', false, true).key).toBe('italic');
  });
});
