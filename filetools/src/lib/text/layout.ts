/**
 * The one text layout engine, shared by the screen (SVG), the PDF writer (pdf-lib) and
 * the rasteriser (canvas). Pure: all font knowledge comes in through `MeasureCtx`.
 *
 * Output coordinates are in points relative to the text box's top-left corner
 * (padding included). Fragments are listed in visual (left-to-right) order.
 */
import type { Paragraph, RunMarks } from './model';
import { baseDirection, NO_SPACE_SCRIPT, wordDirection } from './scripts';

export interface MeasureCtx {
  /** Advance width of `text` in points. */
  width(text: string, marks: RunMarks): number;
  /** Ascent and descent (both positive) in points. */
  metrics(marks: RunMarks): { ascent: number; descent: number };
}

export interface LayoutFragment {
  text: string;
  marks: RunMarks;
  x: number;
  width: number;
  /** Baseline y of the fragment's line. */
  baseline: number;
  line: number;
  rtl: boolean;
  space: boolean;
  /** Width equals the measured width (false for justified spaces). */
  natural: boolean;
}

export interface LayoutLine {
  top: number;
  height: number;
  baseline: number;
  /** Width of the content (excluding trailing spaces, before justification). */
  contentWidth: number;
  paragraph: number;
  fragments: LayoutFragment[];
}

export interface LayoutDecoration {
  kind: 'highlight' | 'underline' | 'strike';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface TextLayout {
  lines: LayoutLine[];
  fragments: LayoutFragment[];
  decorations: LayoutDecoration[];
  /** Total box size (padding included). */
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Box width in points (text wraps inside width − 2·padding). */
  width: number;
  padding: number;
}

/** Underline / strike-through geometry as fractions of the font size. */
export const UNDERLINE_OFFSET = 0.1;
export const STRIKE_OFFSET = 0.3;
export const DECORATION_THICKNESS = 0.05;

interface Piece {
  text: string;
  marks: RunMarks;
  width: number;
}

type Item =
  | { kind: 'word'; pieces: Piece[]; width: number; openEnd: boolean }
  | { kind: 'space'; pieces: Piece[]; width: number }
  | { kind: 'break'; marks: RunMarks };

let wordSegmenter: Intl.Segmenter | null | undefined;
let graphemeSegmenter: Intl.Segmenter | null | undefined;

function segmenter(kind: 'word' | 'grapheme'): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return null;
  if (kind === 'word') return (wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' }));
  return (graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' }));
}

/** Split a space-free token into units with line-break opportunities between them. */
function breakUnits(token: string): string[] {
  if (!NO_SPACE_SCRIPT.test(token)) return [token];
  const seg = segmenter('word');
  if (seg) {
    const out: string[] = [];
    for (const s of seg.segment(token)) {
      // Dictionary segmentation for Thai etc.; CJK falls back to one unit per ideograph.
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s.segment)) out.push(...Array.from(s.segment));
      else out.push(s.segment);
    }
    return out;
  }
  const out: string[] = [];
  let cur = '';
  for (const ch of token) {
    if (NO_SPACE_SCRIPT.test(ch)) {
      if (cur) out.push(cur);
      out.push(ch);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function graphemes(text: string): string[] {
  const seg = segmenter('grapheme');
  return seg ? Array.from(seg.segment(text), (s) => s.segment) : Array.from(text);
}

function tokenize(p: Paragraph, m: MeasureCtx): Item[] {
  const items: Item[] = [];
  for (const run of p.runs) {
    const text = run.text.normalize('NFC');
    const re = /\n|[ \t]+|[^\n \t]+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const tok = match[0];
      const prev = items[items.length - 1];
      if (tok === '\n') {
        items.push({ kind: 'break', marks: run.marks });
      } else if (/^[ \t]+$/.test(tok)) {
        const t = tok.replace(/\t/g, '    ');
        const piece = { text: t, marks: run.marks, width: m.width(t, run.marks) };
        if (prev?.kind === 'space') {
          prev.pieces.push(piece);
          prev.width += piece.width;
        } else items.push({ kind: 'space', pieces: [piece], width: piece.width });
      } else {
        const units = breakUnits(tok);
        units.forEach((u, i) => {
          const piece = { text: u, marks: run.marks, width: m.width(u, run.marks) };
          const gluable = !NO_SPACE_SCRIPT.test(u);
          const last = items[items.length - 1];
          if (i === 0 && last?.kind === 'word' && last.openEnd && gluable) {
            last.pieces.push(piece);
            last.width += piece.width;
            last.openEnd = gluable;
          } else items.push({ kind: 'word', pieces: [piece], width: piece.width, openEnd: gluable });
        });
      }
    }
  }
  return items;
}

/** Break an over-long word into chunks no wider than maxW (at grapheme boundaries). */
function splitLongWord(word: Extract<Item, { kind: 'word' }>, maxW: number, m: MeasureCtx): Extract<Item, { kind: 'word' }>[] {
  const chunks: Extract<Item, { kind: 'word' }>[] = [];
  let cur: Piece[] = [];
  let curW = 0;
  const push = () => {
    if (cur.length) chunks.push({ kind: 'word', pieces: cur, width: curW, openEnd: true });
    cur = [];
    curW = 0;
  };
  for (const piece of word.pieces) {
    for (const g of graphemes(piece.text)) {
      const w = m.width(g, piece.marks);
      if (curW + w > maxW && curW > 0) push();
      const last = cur[cur.length - 1];
      if (last && last.marks === piece.marks) {
        last.text += g;
        last.width += w;
      } else cur.push({ text: g, marks: piece.marks, width: w });
      curW += w;
    }
  }
  push();
  // Re-measure joined chunk pieces for accuracy.
  for (const c of chunks) {
    c.width = 0;
    for (const pc of c.pieces) {
      pc.width = m.width(pc.text, pc.marks);
      c.width += pc.width;
    }
  }
  return chunks;
}

interface RawLine {
  items: Item[];
  /** Ends the paragraph or an explicit line break: never justified. */
  hardEnd: boolean;
  /** Marks to size an empty line. */
  marks: RunMarks;
}

function breakLines(items: Item[], maxW: number, m: MeasureCtx, fallback: RunMarks): RawLine[] {
  const lines: RawLine[] = [];
  let cur: Item[] = [];
  let lastMarks = fallback;
  let wrapped = false;
  const widthOf = (list: Item[]) => list.reduce((s, it) => s + (it.kind === 'break' ? 0 : it.width), 0);
  const flush = (hardEnd: boolean) => {
    while (cur.length && cur[cur.length - 1].kind === 'space') cur.pop();
    lines.push({ items: cur, hardEnd, marks: lastMarks });
    cur = [];
  };
  for (const it of items) {
    if (it.kind === 'break') {
      lastMarks = it.marks;
      flush(true);
      wrapped = false;
      continue;
    }
    lastMarks = it.pieces[it.pieces.length - 1].marks;
    if (it.kind === 'space') {
      if (cur.length === 0 && wrapped) continue; // drop spaces at the start of a wrapped line
      cur.push(it);
      continue;
    }
    const hasWord = cur.some((x) => x.kind === 'word');
    if (hasWord && widthOf(cur) + it.width > maxW + 1e-6) {
      flush(false);
      wrapped = true;
    }
    if (it.width > maxW + 1e-6 && !cur.some((x) => x.kind === 'word')) {
      const chunks = splitLongWord(it, maxW, m);
      chunks.forEach((c, i) => {
        if (i < chunks.length - 1) {
          cur.push(c);
          flush(false);
          wrapped = true;
        } else cur.push(c);
      });
      continue;
    }
    cur.push(it);
  }
  flush(true);
  return lines;
}

function itemText(it: Item): string {
  return it.kind === 'break' ? '' : it.pieces.map((p) => p.text).join('');
}

/** Visual order of a line's items (simplified Unicode bidi: two embedding levels). */
function visualOrder(items: Item[], base: 'ltr' | 'rtl'): { item: Item; rtl: boolean }[] {
  const dirs = items.map((it) => (it.kind === 'word' ? wordDirection(itemText(it)) : 'N'));
  const baseDir = base === 'rtl' ? 'R' : 'L';
  const resolved = dirs.map((d, i) => {
    if (d !== 'N') return d;
    let prev: string | undefined;
    for (let j = i - 1; j >= 0; j--) if (dirs[j] !== 'N') { prev = dirs[j]; break; }
    let next: string | undefined;
    for (let j = i + 1; j < dirs.length; j++) if (dirs[j] !== 'N') { next = dirs[j]; break; }
    return prev && prev === next ? prev : baseDir;
  });
  const segments: { dir: string; items: { item: Item; rtl: boolean }[] }[] = [];
  items.forEach((item, i) => {
    const dir = resolved[i];
    const last = segments[segments.length - 1];
    const entry = { item, rtl: dir === 'R' };
    if (last && last.dir === dir) last.items.push(entry);
    else segments.push({ dir, items: [entry] });
  });
  for (const s of segments) if (s.dir === 'R') s.items.reverse();
  if (base === 'rtl') segments.reverse();
  return segments.flatMap((s) => s.items);
}

export function layoutText(paragraphs: Paragraph[], opts: LayoutOptions, m: MeasureCtx): TextLayout {
  const pad = Math.max(0, opts.padding);
  const maxW = Math.max(1, opts.width - 2 * pad);
  const lines: LayoutLine[] = [];
  const fragments: LayoutFragment[] = [];
  let top = pad;

  paragraphs.forEach((p, pi) => {
    const fallback = p.runs[0]?.marks;
    const items = tokenize(p, m);
    const dir = baseDirection(p.runs.map((r) => r.text).join(''));
    const startSide = dir === 'rtl' ? 'right' : 'left';
    const align = p.align === 'start' ? startSide : p.align;
    for (const raw of breakLines(items, maxW, m, fallback)) {
      const pieces = raw.items.flatMap((it) => (it.kind === 'break' ? [] : it.pieces));
      const sized = pieces.length ? pieces.map((pc) => pc.marks) : [raw.marks];
      const maxSize = Math.max(...sized.map((mk) => mk.size));
      let asc = 0;
      let desc = 0;
      for (const mk of sized) {
        const met = m.metrics(mk);
        asc = Math.max(asc, met.ascent);
        desc = Math.max(desc, met.descent);
      }
      const height = maxSize * p.lineHeight;
      const baseline = top + (height - (asc + desc)) / 2 + asc;
      const contentWidth = raw.items.reduce((s, it) => s + (it.kind === 'break' ? 0 : it.width), 0);

      const lineAlign = align === 'justify' && raw.hardEnd ? startSide : align;
      let offset = 0;
      if (lineAlign === 'right') offset = maxW - contentWidth;
      else if (lineAlign === 'center') offset = (maxW - contentWidth) / 2;
      const ordered = visualOrder(raw.items, dir);
      const innerSpaces = lineAlign === 'justify' ? ordered.filter((o, i) => o.item.kind === 'space' && i > 0 && i < ordered.length - 1) : [];
      const extra = innerSpaces.length ? Math.max(0, maxW - contentWidth) / innerSpaces.length : 0;

      const lineIndex = lines.length;
      const lineFrags: LayoutFragment[] = [];
      let x = pad + offset;
      for (const { item, rtl } of ordered) {
        if (item.kind === 'break') continue;
        const ps = rtl ? [...item.pieces].reverse() : item.pieces;
        const stretch = item.kind === 'space' && innerSpaces.some((s) => s.item === item) ? extra : 0;
        ps.forEach((pc, k) => {
          const add = k === ps.length - 1 ? stretch : 0;
          lineFrags.push({ text: pc.text, marks: pc.marks, x, width: pc.width + add, baseline, line: lineIndex, rtl, space: item.kind === 'space', natural: add === 0 });
          x += pc.width + add;
        });
      }
      lines.push({ top, height, baseline, contentWidth, paragraph: pi, fragments: lineFrags });
      fragments.push(...lineFrags);
      top += height;
    }
  });

  return { lines, fragments, decorations: decorationsFor(fragments, m), width: opts.width, height: top + pad };
}

function decorationsFor(frags: LayoutFragment[], m: MeasureCtx): LayoutDecoration[] {
  const out: LayoutDecoration[] = [];
  const add = (d: LayoutDecoration) => {
    const last = out.find((o) => o.kind === d.kind && o.color === d.color && Math.abs(o.y - d.y) < 1e-6 && Math.abs(o.h - d.h) < 1e-6 && Math.abs(o.x + o.w - d.x) < 1e-6);
    if (last) last.w += d.w;
    else out.push({ ...d });
  };
  for (const f of frags) {
    const { size } = f.marks;
    const th = Math.max(0.5, size * DECORATION_THICKNESS);
    if (f.marks.highlight) {
      const met = m.metrics(f.marks);
      add({ kind: 'highlight', x: f.x, y: f.baseline - met.ascent, w: f.width, h: met.ascent + met.descent, color: f.marks.highlight });
    }
    if (f.marks.underline) add({ kind: 'underline', x: f.x, y: f.baseline + size * UNDERLINE_OFFSET, w: f.width, h: th, color: f.marks.color });
    if (f.marks.strike) add({ kind: 'strike', x: f.x, y: f.baseline - size * STRIKE_OFFSET, w: f.width, h: th, color: f.marks.color });
  }
  // Highlights first so they paint underneath.
  return [...out.filter((d) => d.kind === 'highlight'), ...out.filter((d) => d.kind !== 'highlight')];
}

/**
 * Group adjacent fragments on a line that can be written as one string (same marks,
 * left-to-right, natural widths) — fewer PDF operators and better copy/paste.
 */
export function mergeFragments(frags: LayoutFragment[]): LayoutFragment[] {
  const out: LayoutFragment[] = [];
  for (const f of frags) {
    const last = out[out.length - 1];
    if (
      last && last.line === f.line && !last.rtl && !f.rtl && last.natural && f.natural && last.marks === f.marks &&
      Math.abs(last.x + last.width - f.x) < 1e-6
    ) {
      out[out.length - 1] = { ...last, text: last.text + f.text, width: last.width + f.width, space: last.space && f.space };
    } else out.push({ ...f });
  }
  return out.filter((f) => !f.space || f.text.trim() !== '');
}
