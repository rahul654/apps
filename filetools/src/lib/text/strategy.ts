/**
 * How a text box is written to the PDF (pure, tested):
 *
 * 1. "vector" with standard fonts — every run uses Helvetica/Times/Courier and all text is WinAnsi.
 * 2. "vector" with embedded fonts — characters outside WinAnsi but every glyph exists in the
 *    run's bundled font (checked with fontkit). Standard-font runs with such characters are
 *    switched to the matching Noto family (Helvetica→Noto Sans, Times→Noto Serif,
 *    Courier→Noto Sans Mono). Real, selectable text.
 * 3. "raster" — scripts that need shaping or RTL (Indic, Arabic, Hebrew, Thai, …), CJK, emoji,
 *    leftover combining marks, or any glyph missing from the font: the box is drawn with the
 *    browser's canvas (its shaping + system fallback fonts) and embedded as an image.
 */
import { fontDef, isStandard, resolveVariant, unicodeEquivalent, type FontId, type VariantKey } from '../fonts/registry';
import { isWinAnsiChar } from '../winAnsi';
import type { Paragraph } from './model';
import { analyzeText } from './scripts';

/** Does the bundled font variant have a glyph for this code point? */
export type CoverageFn = (font: FontId, variant: VariantKey, codePoint: number) => boolean;

export interface Substitution {
  from: FontId;
  to: FontId;
}

export type BoxStrategy =
  | {
      kind: 'vector';
      /** Effective font per run: [paragraph][run]. */
      fonts: FontId[][];
      embedded: boolean;
      substitutions: Substitution[];
    }
  | { kind: 'raster'; reason: 'complex-script' | 'emoji' | 'combining-marks' | 'missing-glyphs'; detail: string };

const IGNORABLE = /[\s​‌­]/u;

export function chooseStrategy(paragraphs: Paragraph[], coverage: CoverageFn): BoxStrategy {
  const all = paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');
  const report = analyzeText(all);
  if (report.complex.length) return { kind: 'raster', reason: 'complex-script', detail: report.complex.join(', ') };
  if (report.emoji) return { kind: 'raster', reason: 'emoji', detail: 'emoji' };
  if (report.combining) return { kind: 'raster', reason: 'combining-marks', detail: 'combining accents' };

  const substitutions: Substitution[] = [];
  let embedded = false;
  const fonts: FontId[][] = [];
  for (const p of paragraphs) {
    const row: FontId[] = [];
    for (const r of p.runs) {
      const text = r.text.normalize('NFC');
      let font = r.marks.font;
      if (isStandard(font)) {
        if ([...text].every(isWinAnsiChar)) {
          row.push(font);
          continue;
        }
        const to = unicodeEquivalent(font);
        if (!substitutions.some((s) => s.from === font && s.to === to)) substitutions.push({ from: font, to });
        font = to;
      }
      const variant = resolveVariant(font, r.marks.bold, r.marks.italic).key;
      for (const ch of text) {
        if (IGNORABLE.test(ch)) continue;
        if (!coverage(font, variant, ch.codePointAt(0)!)) {
          return { kind: 'raster', reason: 'missing-glyphs', detail: `${fontDef(font).label} has no glyph for “${ch}”` };
        }
      }
      embedded = true;
      row.push(font);
    }
    fonts.push(row);
  }
  return { kind: 'vector', fonts, embedded, substitutions };
}

/** Fonts (family + variant) the vector writer will need for a strategy. */
export function strategyFonts(paragraphs: Paragraph[], s: Extract<BoxStrategy, { kind: 'vector' }>): { font: FontId; variant: VariantKey }[] {
  const seen = new Map<string, { font: FontId; variant: VariantKey }>();
  paragraphs.forEach((p, pi) =>
    p.runs.forEach((r, ri) => {
      const font = s.fonts[pi][ri];
      const variant = resolveVariant(font, r.marks.bold, r.marks.italic).key;
      seen.set(`${font}|${variant}`, { font, variant });
    }),
  );
  return [...seen.values()];
}

/** Paragraphs with the strategy's effective fonts applied (what actually gets drawn). */
export function applyStrategyFonts(paragraphs: Paragraph[], s: BoxStrategy): Paragraph[] {
  if (s.kind !== 'vector' || s.substitutions.length === 0) return paragraphs;
  return paragraphs.map((p, pi) => ({ ...p, runs: p.runs.map((r, ri) => (s.fonts[pi][ri] === r.marks.font ? r : { text: r.text, marks: { ...r.marks, font: s.fonts[pi][ri] } })) }));
}

export function describeStrategy(s: BoxStrategy): string {
  if (s.kind === 'raster') {
    const why = s.reason === 'complex-script' ? `${s.detail} text` : s.reason === 'emoji' ? 'emoji' : s.reason === 'combining-marks' ? 'combining accents' : s.detail;
    return `Saves as image — not selectable (${why})`;
  }
  if (s.substitutions.length) return `Uses ${s.substitutions.map((x) => `${fontDef(x.to).label} instead of ${fontDef(x.from).label}`).join(', ')} for non-Latin characters`;
  return s.embedded ? 'Embedded font — selectable text' : 'Standard PDF font — selectable text';
}
