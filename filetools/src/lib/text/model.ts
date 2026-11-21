/**
 * Rich text model: box → paragraphs → runs (text + marks). Pure functions only.
 *
 * Offsets used by the range operations are "global": characters of all paragraphs
 * concatenated, with one extra position between paragraphs (like a newline).
 */
import type { FontId } from '../fonts/registry';

export interface RunMarks {
  font: FontId;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  /** Background colour behind the run, or null. */
  highlight: string | null;
}

export interface Run {
  /** May contain "\n" for an explicit line break inside the paragraph. */
  text: string;
  marks: RunMarks;
}

/** 'start' = left for left-to-right paragraphs, right for right-to-left ones. */
export type Align = 'start' | 'left' | 'center' | 'right' | 'justify';

export interface Paragraph {
  /** Never empty: an empty paragraph keeps one run with text "" (its marks give the line height). */
  runs: Run[];
  align: Align;
  /** Line height as a multiple of the largest font size on the line. */
  lineHeight: number;
}

export type BoolMark = 'bold' | 'italic' | 'underline' | 'strike';

export interface TextRange {
  start: number;
  end: number;
}

export const DEFAULT_MARKS: RunMarks = {
  font: 'Helvetica',
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: '#111111',
  highlight: null,
};

export const LINE_HEIGHTS = [1, 1.15, 1.5, 2];
export const DEFAULT_LINE_HEIGHT = 1.15;

export function marksEqual(a: RunMarks, b: RunMarks): boolean {
  return (
    a.font === b.font && a.size === b.size && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline &&
    a.strike === b.strike && a.color.toLowerCase() === b.color.toLowerCase() && (a.highlight ?? '') === (b.highlight ?? '')
  );
}

/** Merge adjacent runs with equal marks and drop empty runs (keeping one if the paragraph is empty). */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && marksEqual(last.marks, r.marks)) out[out.length - 1] = { text: last.text + r.text, marks: last.marks };
    else out.push({ text: r.text, marks: { ...r.marks } });
  }
  if (out.length === 0) return [{ text: '', marks: { ...(runs[0]?.marks ?? DEFAULT_MARKS) } }];
  return out;
}

export function normalizeParagraphs(paras: Paragraph[]): Paragraph[] {
  const list = paras.length ? paras : [makeParagraph('', DEFAULT_MARKS)];
  return list.map((p) => ({ ...p, runs: normalizeRuns(p.runs) }));
}

export function makeParagraph(text: string, marks: RunMarks, align: Align = 'start', lineHeight = DEFAULT_LINE_HEIGHT): Paragraph {
  return { runs: [{ text, marks: { ...marks } }], align, lineHeight };
}

/** Plain text → paragraphs (blank-line-free split on newlines). */
export function paragraphsFromText(text: string, marks: RunMarks, align: Align = 'start', lineHeight = DEFAULT_LINE_HEIGHT): Paragraph[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => makeParagraph(line, marks, align, lineHeight));
}

export function paragraphText(p: Paragraph): string {
  return p.runs.map((r) => r.text).join('');
}

export function plainText(paras: Paragraph[]): string {
  return paras.map(paragraphText).join('\n');
}

export function textLength(paras: Paragraph[]): number {
  return paras.reduce((s, p) => s + paragraphText(p).length, 0) + Math.max(0, paras.length - 1);
}

/** Split runs so that `offset` (within the paragraph) falls on a run boundary. */
export function splitRunsAt(runs: Run[], offset: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.text.length;
    if (offset > pos && offset < end) {
      out.push({ text: r.text.slice(0, offset - pos), marks: r.marks }, { text: r.text.slice(offset - pos), marks: r.marks });
    } else out.push(r);
    pos = end;
  }
  return out;
}

/** Apply `fn` to every run, including empty-paragraph placeholders. */
function mapAll(paras: Paragraph[], fn: (m: RunMarks) => RunMarks): Paragraph[] {
  return paras.map((p) => ({ ...p, runs: normalizeRuns(p.runs.map((r) => ({ text: r.text, marks: fn(r.marks) }))) }));
}

/** Apply `fn` to the marks of every character inside the global range (all text when range is null). */
export function mapMarks(paras: Paragraph[], range: TextRange | null, fn: (m: RunMarks) => RunMarks): Paragraph[] {
  if (range === null) return mapAll(paras, fn);
  let base = 0;
  return paras.map((p) => {
    const len = paragraphText(p).length;
    const pStart = base;
    base += len + 1;
    if (len === 0) {
      // Empty paragraph inside the range: update its placeholder marks.
      return range.start <= pStart && range.end >= pStart ? { ...p, runs: [{ text: '', marks: fn(p.runs[0].marks) }] } : p;
    }
    const s = Math.max(0, range.start - pStart);
    const e = Math.min(len, range.end - pStart);
    if (e <= s) return p;
    const split = splitRunsAt(splitRunsAt(p.runs, s), e);
    let pos = 0;
    const runs = split.map((r) => {
      const rs = pos;
      pos += r.text.length;
      return rs >= s && pos <= e && r.text ? { text: r.text, marks: fn(r.marks) } : r;
    });
    return { ...p, runs: normalizeRuns(runs) };
  });
}

export function setMarks(paras: Paragraph[], range: TextRange | null, patch: Partial<RunMarks>): Paragraph[] {
  return mapMarks(paras, range, (m) => ({ ...m, ...patch }));
}

/** Every non-empty character in range has the mark set? */
export function rangeHasMark(paras: Paragraph[], range: TextRange | null, mark: BoolMark): boolean {
  let all = true;
  let any = false;
  forEachRunInRange(paras, range, (r) => {
    any = true;
    if (!r.marks[mark]) all = false;
  });
  return any && all;
}

/** Toggle a boolean mark: on for the whole range unless it's already on everywhere. */
export function toggleMark(paras: Paragraph[], range: TextRange | null, mark: BoolMark): Paragraph[] {
  const on = !rangeHasMark(paras, range, mark);
  return setMarks(paras, range, { [mark]: on } as Partial<RunMarks>);
}

/** Reset formatting to `defaults` (font, size, colour, no bold/italic/underline/strike/highlight). */
export function clearFormatting(paras: Paragraph[], range: TextRange | null, defaults: RunMarks): Paragraph[] {
  return mapMarks(paras, range, () => ({ ...defaults, highlight: null, bold: false, italic: false, underline: false, strike: false }));
}

/** Run callback for every run segment (non-empty) inside the range. */
export function forEachRunInRange(paras: Paragraph[], range: TextRange | null, cb: (r: Run, paragraph: number) => void): void {
  let base = 0;
  paras.forEach((p, pi) => {
    let pos = base;
    for (const r of p.runs) {
      const rs = pos;
      const re = pos + r.text.length;
      pos = re;
      if (!r.text) continue;
      if (range === null) cb(r, pi);
      else {
        const s = Math.max(rs, range.start);
        const e = Math.min(re, range.end);
        if (e > s) cb({ text: r.text.slice(s - rs, e - rs), marks: r.marks }, pi);
      }
    }
    base += paragraphText(p).length + 1;
  });
}

/** Marks shared by all runs in range; a key is undefined when values differ. */
export function commonMarks(paras: Paragraph[], range: TextRange | null): Partial<RunMarks> {
  let acc: Partial<RunMarks> | null = null;
  const visit = (m: RunMarks) => {
    if (!acc) {
      acc = { ...m };
      return;
    }
    for (const k of Object.keys(acc) as (keyof RunMarks)[]) if (acc[k] !== m[k]) delete acc[k];
  };
  forEachRunInRange(paras, range, (r) => visit(r.marks));
  if (!acc) visit(paras[0]?.runs[0]?.marks ?? DEFAULT_MARKS);
  return acc ?? {};
}

export function setParagraphProps(paras: Paragraph[], patch: Partial<Pick<Paragraph, 'align' | 'lineHeight'>>, paragraphIndexes?: number[]): Paragraph[] {
  return paras.map((p, i) => (!paragraphIndexes || paragraphIndexes.includes(i) ? { ...p, ...patch } : p));
}

export function scaleSizes(paras: Paragraph[], factor: number): Paragraph[] {
  return mapAll(paras, (m) => ({ ...m, size: Math.max(2, Math.min(500, Math.round(m.size * factor * 10) / 10)) }));
}

/** All fonts used by the box (for loading). */
export function fontsUsed(paras: Paragraph[]): { font: FontId; bold: boolean; italic: boolean }[] {
  const seen = new Map<string, { font: FontId; bold: boolean; italic: boolean }>();
  for (const p of paras) for (const r of p.runs) seen.set(`${r.marks.font}|${r.marks.bold}|${r.marks.italic}`, { font: r.marks.font, bold: r.marks.bold, italic: r.marks.italic });
  return [...seen.values()];
}
