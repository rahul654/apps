/**
 * Invisible OCR text layer for PDFs — the same technique as Tesseract's own PDF renderer:
 *
 * - A Type0 / CIDFontType2 font ("GlyphLessFont") with Identity-H encoding: each character
 *   code is a UTF-16 code unit. A CIDToGIDMap sends every code to the font's one empty
 *   glyph, and a ToUnicode CMap maps every code to itself — so copy/search returns exactly
 *   the recognised Unicode string in any script (Devanagari, CJK, Arabic…), with no font
 *   coverage or shaping needed. Every code is 500 units wide.
 * - Text render mode 3 (invisible). Each word is placed at its box: font size = box height,
 *   baseline at the box bottom, and horizontal scaling (Tz) stretches it to the box width,
 *   so selection highlights line up with the scanned words.
 * - Drawn on top of the original page content, which stays untouched.
 */
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFRef,
  PDFString,
  type PDFPage,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from 'pdf-lib';
import { displayToPdf, type PageGeometry } from '../coords';
import { isolateExistingContent } from '../pdf/ops';
import { glyphlessTtf } from './glyphlessFont';

/** A recognised word in display-space points (top-left origin, after /Rotate). */
export interface OcrWordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLineBox {
  words: OcrWordBox[];
}

/** Width of every glyph in the glyphless font, in 1/1000 em. */
export const GLYPH_WIDTH = 500;

const fontCache = new WeakMap<PDFDocument, PDFRef>();

function toUnicodeCMap(): string {
  // Identity map for every 16-bit code. Ranges may only vary in the last byte, so 256 of them.
  const ranges: string[] = [];
  for (let hi = 0; hi < 256; hi++) {
    const h = hi.toString(16).padStart(2, '0').toUpperCase();
    ranges.push(`<${h}00> <${h}FF> <${h}00>`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) {
    const chunk = ranges.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfrange\n${chunk.join('\n')}\nendbfrange`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** Embed the glyphless Type0 font once per document. */
export function embedGlyphlessFont(doc: PDFDocument): PDFRef {
  const cached = fontCache.get(doc);
  if (cached) return cached;
  const ctx = doc.context;
  const ttf = glyphlessTtf();
  const fontFile = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = ctx.register(
    ctx.obj({
      Type: 'FontDescriptor',
      FontName: 'GlyphLessFont',
      Flags: 5,
      FontBBox: [0, 0, GLYPH_WIDTH, 1000],
      ItalicAngle: 0,
      Ascent: 1000,
      Descent: -1,
      CapHeight: 1000,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  // CIDToGIDMap: every CID → glyph 1 (two bytes per CID, big-endian).
  const map = new Uint8Array(2 * 65536);
  for (let i = 1; i < map.length; i += 2) map[i] = 1;
  const cidToGid = ctx.register(ctx.flateStream(map));
  const cidFont = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'GlyphLessFont',
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: GLYPH_WIDTH,
      CIDToGIDMap: cidToGid,
    }),
  );
  const toUnicode = ctx.register(ctx.flateStream(toUnicodeCMap()));
  const type0 = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'GlyphLessFont',
      Encoding: 'Identity-H',
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode,
    }),
  );
  fontCache.set(doc, type0);
  return type0;
}

/** UTF-16BE hex of a string (one character code per UTF-16 code unit). */
export function utf16Hex(text: string): { hex: string; units: number } {
  let hex = '';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return { hex, units: text.length };
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * A word as three points in PDF user space: baseline start, baseline end (the width the
 * text should span) and the top of the word above the baseline start. Deriving angle,
 * size and stretch from these mapped points makes the layer correct for any combination
 * of /Rotate, crop offsets and rotation applied before OCR.
 */
export interface WordQuad {
  text: string;
  p0: Pt;
  p1: Pt;
  top: Pt;
}

export interface PlacedWord {
  text: string;
  /** Text matrix: unit baseline direction (a, b), unit "up" direction (c, d), origin (x, y). */
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
  size: number;
  /** Horizontal scaling in percent. */
  scale: number;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Matrix, font size and stretch for one word (pure, tested). */
export function placeQuad(q: WordQuad): PlacedWord | null {
  const ux = q.p1.x - q.p0.x;
  const uy = q.p1.y - q.p0.y;
  const vx = q.top.x - q.p0.x;
  const vy = q.top.y - q.p0.y;
  const len = Math.hypot(ux, uy);
  const size = Math.hypot(vx, vy);
  if (!(len > 0) || !(size > 0) || !q.text) return null;
  const natural = (q.text.length * GLYPH_WIDTH * size) / 1000;
  return { text: q.text, a: round(ux / len), b: round(uy / len), c: round(vx / size), d: round(vy / size), x: q.p0.x, y: q.p0.y, size, scale: (100 * len) / natural };
}

/** Maps a point of the OCR'd image (pixels, y down) to PDF user space. */
export type PixelToPdf = (x: number, y: number) => Pt;

interface PixelWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Word quads from OCR lines (boxes in the OCR'd image, where text runs left to right).
 * Each word but the last on a line gets a trailing space and spans up to the next word,
 * so copied text has spaces between words.
 */
export function quadsFromOcrLines(lines: { words: PixelWord[] }[], map: PixelToPdf): WordQuad[] {
  const out: WordQuad[] = [];
  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim() && w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0);
    words.forEach((w, i) => {
      const next = words[i + 1];
      const end = next && next.bbox.x0 > w.bbox.x1 ? next.bbox.x0 : w.bbox.x1;
      out.push({
        text: next ? `${w.text.trim()} ` : w.text.trim(),
        p0: map(w.bbox.x0, w.bbox.y1),
        p1: map(end, w.bbox.y1),
        top: map(w.bbox.x0, w.bbox.y0),
      });
    });
  }
  return out;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

/**
 * Pixel → PDF mapping for a page rendered by pdf.js at `scale` (CSS px per point, the
 * render shows the page as displayed, i.e. with /Rotate applied) and then rotated
 * clockwise by `ocrRotation` before OCR. (renderWidth, renderHeight) = rendered size.
 */
export function renderPixelMapper(g: PageGeometry, scale: number, renderWidth: number, renderHeight: number, ocrRotation: QuarterTurn = 0): PixelToPdf {
  return (x, y) => {
    // Undo the clockwise OCR-time rotation → rendered-page pixel.
    let rx = x;
    let ry = y;
    if (ocrRotation === 90) {
      rx = y;
      ry = renderHeight - x;
    } else if (ocrRotation === 180) {
      rx = renderWidth - x;
      ry = renderHeight - y;
    } else if (ocrRotation === 270) {
      rx = renderWidth - y;
      ry = x;
    }
    return displayToPdf(g, rx / scale, ry / scale);
  };
}

/** Forward of the clockwise rotation used before OCR (for tests and tools). */
export function rotatePixel(x: number, y: number, renderWidth: number, renderHeight: number, r: QuarterTurn): Pt {
  if (r === 90) return { x: renderHeight - y, y: x };
  if (r === 180) return { x: renderWidth - x, y: renderHeight - y };
  if (r === 270) return { x: y, y: renderWidth - x };
  return { x, y };
}

/** Display-space lines (points, already upright) → quads, e.g. for simple callers. */
export function quadsFromDisplayLines(g: PageGeometry, lines: OcrLineBox[]): WordQuad[] {
  return quadsFromOcrLines(
    lines.map((l) => ({ words: l.words.map((w) => ({ text: w.text, bbox: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 } })) })),
    (x, y) => displayToPdf(g, x, y),
  );
}

/** Add an invisible, searchable text layer to an existing page. Returns the number of words written. */
export function addInvisibleTextLayer(doc: PDFDocument, page: PDFPage, quads: WordQuad[]): number {
  const placed = quads.map(placeQuad).filter((p): p is PlacedWord => p !== null);
  if (placed.length === 0) return 0;
  const fontRef = embedGlyphlessFont(doc);
  isolateExistingContent(page);
  const name: PDFName = page.node.newFontDictionary('FtOcr', fontRef);
  const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const w of placed) {
    ops.push(
      setFontAndSize(name, w.size),
      setTextMatrix(w.a, w.b, w.c, w.d, w.x, w.y),
      setCharacterSqueeze(Math.round(w.scale * 100) / 100),
      showText(PDFHexString.of(utf16Hex(w.text).hex)),
    );
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
  return placed.length;
}
