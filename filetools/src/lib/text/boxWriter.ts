/**
 * Writing rich text boxes into a PDF: picks the save strategy per box, embeds the
 * needed fonts once per document, and draws either real text or a rasterised image.
 * No DOM here — rasterising is injected (browser canvas, or @napi-rs/canvas in tests).
 */
import { degrees, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Font as FontkitFont } from '@pdf-lib/fontkit';
import { displayToPdf, type PageGeometry } from '../coords';
import { fontDef, isStandard, NO_SUBSTITUTION_FEATURES, resolveVariant, unicodeEquivalent, type FontId, type VariantKey } from '../fonts/registry';
import type { EmbeddableImage } from '../pdf/ops';
import { isWinAnsiChar } from '../winAnsi';
import { layoutText } from './layout';
import { standardFontName, vectorMeasure } from './measure';
import type { Paragraph, RunMarks } from './model';
import { drawLayoutToPdf } from './render';
import { analyzeText } from './scripts';
import { applyStrategyFonts, chooseStrategy, describeStrategy, type BoxStrategy } from './strategy';

export interface FontkitModule {
  create(bytes: Uint8Array): FontkitFont;
}

export interface RasterRequest {
  paragraphs: Paragraph[];
  width: number;
  padding: number;
  background: string | null;
  dpi: number;
}

export interface RasterResult {
  image: EmbeddableImage;
  /** Box height in points that the image covers. */
  height: number;
}

export interface TextSaveDeps {
  fontkit: FontkitModule;
  fontBytes(font: FontId, variant: VariantKey): Promise<Uint8Array>;
  /** Rasterise a box with the browser's text engine. Without it, complex boxes are skipped with a warning. */
  rasterize?(req: RasterRequest): Promise<RasterResult>;
}

export const RASTER_DPI = 300;

/** Per-document cache of parsed and embedded fonts. */
export class FontCache {
  private parsed = new Map<string, FontkitFont>();
  private embedded = new Map<string, Promise<PDFFont>>();
  private registered = false;
  private readonly doc: PDFDocument;
  private readonly deps: TextSaveDeps;

  constructor(doc: PDFDocument, deps: TextSaveDeps) {
    this.doc = doc;
    this.deps = deps;
  }

  async fontkitFont(font: FontId, variant: VariantKey): Promise<FontkitFont> {
    const k = `${font}|${variant}`;
    let f = this.parsed.get(k);
    if (!f) {
      f = this.deps.fontkit.create(await this.deps.fontBytes(font, variant));
      this.parsed.set(k, f);
    }
    return f;
  }

  lookup = (font: FontId, variant: VariantKey): FontkitFont | undefined => this.parsed.get(`${font}|${variant}`);

  pdfFont(marks: RunMarks): Promise<PDFFont> {
    const v = resolveVariant(marks.font, marks.bold, marks.italic);
    const k = `${marks.font}|${v.key}`;
    let p = this.embedded.get(k);
    if (!p) {
      p = (async () => {
        if (isStandard(marks.font)) return this.doc.embedFont(standardFontName(marks.font as 'Helvetica', v.bold, v.italic));
        if (!this.registered) {
          this.doc.registerFontkit(this.deps.fontkit as never);
          this.registered = true;
        }
        const bytes = await this.deps.fontBytes(marks.font, v.key);
        return this.doc.embedFont(bytes, { subset: fontDef(marks.font).subset, features: { ...NO_SUBSTITUTION_FEATURES } });
      })();
      this.embedded.set(k, p);
    }
    return p;
  }

  /** Make sure every font a box could use is parsed, so coverage checks can run synchronously. */
  async preloadFor(paragraphs: Paragraph[]): Promise<void> {
    for (const p of paragraphs) {
      for (const r of p.runs) {
        const ids: FontId[] = [];
        if (!isStandard(r.marks.font)) ids.push(r.marks.font);
        else if (![...r.text].every(isWinAnsiChar)) ids.push(unicodeEquivalent(r.marks.font));
        for (const id of ids) {
          try {
            await this.fontkitFont(id, resolveVariant(id, r.marks.bold, r.marks.italic).key);
          } catch {
            /* unavailable font: no coverage → the box will be rasterised */
          }
        }
      }
    }
  }

  coverage = (font: FontId, variant: VariantKey, cp: number): boolean => this.lookup(font, variant)?.hasGlyphForCodePoint(cp) ?? false;
}

export interface TextBoxInput {
  x: number;
  y: number;
  w: number;
  paragraphs: Paragraph[];
  background: string | null;
  padding: number;
  opacity: number;
}

export interface WriteResult {
  strategy: BoxStrategy;
  note: string;
  /** False if the box couldn't be written (raster needed but no rasteriser). */
  written: boolean;
}

export async function writeTextBox(doc: PDFDocument, page: PDFPage, g: PageGeometry, box: TextBoxInput, cache: FontCache, deps: TextSaveDeps): Promise<WriteResult> {
  // Complex scripts are rasterised regardless of fonts, so don't load any for them.
  const report = analyzeText(box.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(''));
  if (!report.complex.length && !report.emoji && !report.combining) await cache.preloadFor(box.paragraphs);
  const strategy = chooseStrategy(box.paragraphs, cache.coverage);
  const note = describeStrategy(strategy);
  if (strategy.kind === 'vector') {
    const paragraphs = applyStrategyFonts(box.paragraphs, strategy);
    // Every font needed for measuring must be parsed (substitutes included).
    for (const p of paragraphs) for (const r of p.runs) if (!isStandard(r.marks.font)) await cache.fontkitFont(r.marks.font, resolveVariant(r.marks.font, r.marks.bold, r.marks.italic).key);
    const layout = layoutText(paragraphs, { width: box.w, padding: box.padding }, vectorMeasure(cache.lookup));
    const fonts = new Map<RunMarks, PDFFont>();
    for (const f of layout.fragments) if (!fonts.has(f.marks)) fonts.set(f.marks, await cache.pdfFont(f.marks));
    drawLayoutToPdf(page, g, box.x, box.y, layout, { background: box.background, opacity: box.opacity }, (m) => fonts.get(m)!);
    return { strategy, note, written: true };
  }
  if (!deps.rasterize) return { strategy, note, written: false };
  const { image, height } = await deps.rasterize({ paragraphs: box.paragraphs, width: box.w, padding: box.padding, background: box.background, dpi: RASTER_DPI });
  const embedded = await doc.embedPng(image.bytes);
  const p = displayToPdf(g, box.x, box.y + height);
  page.drawImage(embedded, { x: p.x, y: p.y, width: box.w, height, rotate: degrees(g.rotation), opacity: box.opacity < 1 ? box.opacity : undefined });
  return { strategy, note, written: true };
}

