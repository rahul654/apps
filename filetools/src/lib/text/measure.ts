/**
 * Measurement backends for the layout engine.
 *
 * - Vector: the exact widths the PDF will use — pdf-lib's AFM metrics for standard fonts,
 *   fontkit glyph advances (no ligatures/alternates, no kerning — same as pdf-lib's
 *   drawText) for bundled fonts. Used on screen too, so line breaks match the PDF.
 * - Canvas: the browser's own measureText (shaping, fallback fonts) — for boxes that are
 *   rasterised, on screen and in the rasteriser alike.
 */
import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import type { Font as FontkitFont } from '@pdf-lib/fontkit';
import { cssFontFamily, fontDef, NO_SUBSTITUTION_FEATURES, resolveVariant, type FontId, type VariantKey } from '../fonts/registry';
import type { MeasureCtx } from './layout';
import type { RunMarks } from './model';

const STANDARD_NAMES: Record<'Helvetica' | 'Times' | 'Courier', [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

export function standardFontName(font: 'Helvetica' | 'Times' | 'Courier', bold: boolean, italic: boolean): StandardFonts {
  return STANDARD_NAMES[font][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

const embedders = new Map<StandardFonts, StandardFontEmbedder>();
function standardEmbedder(name: StandardFonts): StandardFontEmbedder {
  let e = embedders.get(name);
  if (!e) {
    e = StandardFontEmbedder.for(name as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
    embedders.set(name, e);
  }
  return e;
}

export function metricsFor(marks: RunMarks): { ascent: number; descent: number } {
  const def = fontDef(marks.font);
  return { ascent: def.ascent * marks.size, descent: def.descent * marks.size };
}

/** Look up a loaded fontkit font for a family variant (undefined if not loaded yet). */
export type FontkitLookup = (font: FontId, variant: VariantKey) => FontkitFont | undefined;

export function fontkitWidth(font: FontkitFont, text: string, size: number): number {
  const run = font.layout(text, { ...NO_SUBSTITUTION_FEATURES });
  let w = 0;
  for (const g of run.glyphs) w += g.advanceWidth;
  return (w / font.unitsPerEm) * size;
}

/**
 * Vector measurement. `fallback` handles fonts not loaded yet (screen only) so the
 * box can show immediately and re-layout once the font arrives.
 */
export function vectorMeasure(lookup: FontkitLookup, fallback?: MeasureCtx): MeasureCtx {
  const cache = new Map<string, number>();
  return {
    metrics: metricsFor,
    width(text, marks) {
      const key = `${marks.font}|${marks.bold}|${marks.italic}|${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit * marks.size;
      let unit: number;
      const def = fontDef(marks.font);
      if (def.kind === 'standard') {
        const name = standardFontName(marks.font as 'Helvetica', marks.bold, marks.italic);
        try {
          unit = standardEmbedder(name).widthOfTextAtSize(text, 1);
        } catch {
          unit = text.length * 0.55; // non-WinAnsi in a standard font: only for provisional layout
        }
      } else {
        const v = resolveVariant(marks.font, marks.bold, marks.italic).key;
        const fk = lookup(marks.font, v);
        if (!fk) return fallback ? fallback.width(text, marks) : text.length * 0.55 * marks.size;
        unit = fontkitWidth(fk, text, 1);
      }
      cache.set(key, unit);
      return unit * marks.size;
    },
  };
}

/** CSS font shorthand for canvas, matching the SVG display styles. */
export function canvasFont(marks: RunMarks, scale = 1): string {
  const v = resolveVariant(marks.font, marks.bold, marks.italic);
  return `${v.italic ? 'italic ' : ''}${v.bold ? '700' : '400'} ${marks.size * scale}px ${cssFontFamily(marks.font)}`;
}

/** Minimal canvas surface we need (DOM canvas or @napi-rs/canvas in tests). */
export interface Canvas2D {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  direction: CanvasDirection;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
}

export function canvasMeasure(ctx: Canvas2D): MeasureCtx {
  const cache = new Map<string, number>();
  return {
    metrics: metricsFor,
    width(text, marks) {
      const font = canvasFont({ ...marks, size: 100 });
      const key = `${font}|${text}`;
      let w = cache.get(key);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(text).width / 100;
        cache.set(key, w);
      }
      return w * marks.size;
    },
  };
}
