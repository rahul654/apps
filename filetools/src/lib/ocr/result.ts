/** Normalised OCR results (independent of tesseract.js types) and helpers. Pure. */
import type { OcrLineBox } from './textLayer';

export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: PixelBox;
  confidence: number;
}

export interface OcrLine {
  words: OcrWord[];
  bbox: PixelBox;
}

export interface OcrPage {
  text: string;
  /** 0–100, mean word confidence weighted by length. */
  confidence: number;
  lines: OcrLine[];
  /** Size of the image that was recognised (bbox coordinates refer to it). */
  width: number;
  height: number;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: PixelBox;
}
interface TessLine {
  words: TessWord[];
  bbox: PixelBox;
}
interface TessBlock {
  paragraphs: { lines: TessLine[] }[];
}

/** Convert a tesseract.js `data` object (with blocks) to our shape. */
export function fromTesseract(data: { blocks: TessBlock[] | null; text: string }, width: number, height: number): OcrPage {
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), bbox: { ...w.bbox }, confidence: w.confidence }));
        if (words.length) lines.push({ words, bbox: { ...l.bbox } });
      }
  return { text: data.text ?? '', confidence: weightedConfidence(lines), lines, width, height };
}

export function weightedConfidence(lines: OcrLine[]): number {
  let sum = 0;
  let n = 0;
  for (const l of lines)
    for (const w of l.words) {
      const len = [...w.text].length;
      sum += w.confidence * len;
      n += len;
    }
  return n ? Math.round((sum / n) * 10) / 10 : 0;
}

export interface TextWithOffsets {
  text: string;
  /** [start, end) offset of each word in `text`, in line/word order. */
  offsets: { line: number; word: number; start: number; end: number }[];
}

/** Plain text built from the lines (words joined by spaces, lines by newlines), with word offsets. */
export function textFromLines(lines: OcrLine[]): TextWithOffsets {
  let text = '';
  const offsets: TextWithOffsets['offsets'] = [];
  lines.forEach((l, li) => {
    if (li > 0) text += '\n';
    l.words.forEach((w, wi) => {
      if (wi > 0) text += ' ';
      offsets.push({ line: li, word: wi, start: text.length, end: text.length + w.text.length });
      text += w.text;
    });
  });
  return { text, offsets };
}

/** Pixel boxes at `scale` px per point → display-space points, ready for the text layer. */
export function linesToDisplay(lines: OcrLine[], scale: number, offsetX = 0, offsetY = 0): OcrLineBox[] {
  return lines.map((l) => ({
    words: l.words.map((w) => ({
      text: w.text,
      x0: offsetX + w.bbox.x0 / scale,
      y0: offsetY + w.bbox.y0 / scale,
      x1: offsetX + w.bbox.x1 / scale,
      y1: offsetY + w.bbox.y1 / scale,
    })),
  }));
}

/** Rough similarity 0–1 (1 − normalised Levenshtein distance), for tests and quality hints. */
export function similarity(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (!x.length && !y.length) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

/** Does a page's existing text layer contain meaningful text? (pdf.js getTextContent items) */
export function hasMeaningfulText(items: { str?: string }[], minChars = 12): boolean {
  let n = 0;
  for (const it of items) {
    for (const ch of it.str ?? '') if (/[\p{L}\p{M}\p{N}]/u.test(ch)) n++;
    if (n >= minChars) return true;
  }
  return false;
}
