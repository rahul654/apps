/**
 * Font families available in the PDF editor.
 *
 * - "standard": the PDF standard 14 fonts (Helvetica/Times/Courier). Nothing to download,
 *   but they only encode WinAnsi (Latin-1-ish) characters.
 * - "bundled": SIL OFL fonts shipped with the app (src/assets/fonts/<dir>/, licence alongside).
 *   Loaded on demand: FontFace for the screen, raw bytes + fontkit for measuring and embedding.
 *
 * Pure data — safe to import from Node tests.
 */

export type FontId =
  | 'Helvetica'
  | 'Times'
  | 'Courier'
  | 'NotoSans'
  | 'NotoSerif'
  | 'NotoSansMono'
  | 'PlayfairDisplay'
  | 'DancingScript'
  | 'Caveat';

export type VariantKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface FontFamilyDef {
  id: FontId;
  label: string;
  kind: 'standard' | 'bundled';
  category: 'sans' | 'serif' | 'mono' | 'display' | 'handwriting';
  /** CSS font-family name used for the FontFace (bundled) or system stack (standard). */
  cssFamily: string;
  /** Fallback stack appended after cssFamily. */
  cssFallback: string;
  /** File paths relative to src/assets/fonts/, per available variant. */
  files: Partial<Record<VariantKey, string>>;
  /**
   * Embed a subset in PDFs? Verified per font by rendering subset vs full output with
   * pdf.js (see pdf.fonts.test.ts). pdf-lib's subsetter drops glyphs for Noto and
   * Caveat, and full embedding crashes on Dancing Script, so this differs per family.
   */
  subset: boolean;
  /** Ascent / descent as a fraction of the em (positive numbers), from the font's hhea table (AFM for standard). */
  ascent: number;
  descent: number;
  /** Human-readable script coverage. */
  scripts: string;
  licenseFile?: string;
}

const NOTO_SCRIPTS = 'Latin, Latin Extended, Cyrillic, Greek, Vietnamese';

export const FONT_FAMILIES: FontFamilyDef[] = [
  {
    id: 'Helvetica', label: 'Helvetica', kind: 'standard', category: 'sans',
    cssFamily: 'Arial', cssFallback: "Helvetica, 'Liberation Sans', sans-serif",
    files: {}, subset: false, ascent: 0.718, descent: 0.207, scripts: 'Latin only (WinAnsi)',
  },
  {
    id: 'Times', label: 'Times', kind: 'standard', category: 'serif',
    cssFamily: 'Times New Roman', cssFallback: "Times, 'Liberation Serif', serif",
    files: {}, subset: false, ascent: 0.683, descent: 0.217, scripts: 'Latin only (WinAnsi)',
  },
  {
    id: 'Courier', label: 'Courier', kind: 'standard', category: 'mono',
    cssFamily: 'Courier New', cssFallback: "Courier, 'Liberation Mono', monospace",
    files: {}, subset: false, ascent: 0.629, descent: 0.157, scripts: 'Latin only (WinAnsi)',
  },
  {
    id: 'NotoSans', label: 'Noto Sans', kind: 'bundled', category: 'sans',
    cssFamily: 'FT Noto Sans', cssFallback: 'system-ui, sans-serif',
    files: { regular: 'noto-sans/NotoSans-Regular.ttf', bold: 'noto-sans/NotoSans-Bold.ttf', italic: 'noto-sans/NotoSans-Italic.ttf', boldItalic: 'noto-sans/NotoSans-BoldItalic.ttf' },
    subset: false, ascent: 1.069, descent: 0.293, scripts: NOTO_SCRIPTS, licenseFile: 'noto-sans/OFL.txt',
  },
  {
    id: 'NotoSerif', label: 'Noto Serif', kind: 'bundled', category: 'serif',
    cssFamily: 'FT Noto Serif', cssFallback: 'serif',
    files: { regular: 'noto-serif/NotoSerif-Regular.ttf', bold: 'noto-serif/NotoSerif-Bold.ttf', italic: 'noto-serif/NotoSerif-Italic.ttf', boldItalic: 'noto-serif/NotoSerif-BoldItalic.ttf' },
    subset: false, ascent: 1.069, descent: 0.293, scripts: NOTO_SCRIPTS, licenseFile: 'noto-serif/OFL.txt',
  },
  {
    id: 'NotoSansMono', label: 'Noto Sans Mono', kind: 'bundled', category: 'mono',
    cssFamily: 'FT Noto Sans Mono', cssFallback: 'monospace',
    files: { regular: 'noto-sans-mono/NotoSansMono-Regular.ttf', bold: 'noto-sans-mono/NotoSansMono-Bold.ttf' },
    subset: false, ascent: 1.069, descent: 0.293, scripts: NOTO_SCRIPTS, licenseFile: 'noto-sans-mono/OFL.txt',
  },
  {
    id: 'PlayfairDisplay', label: 'Playfair Display', kind: 'bundled', category: 'display',
    cssFamily: 'FT Playfair Display', cssFallback: 'serif',
    files: { regular: 'playfair-display/PlayfairDisplay-Regular.ttf', bold: 'playfair-display/PlayfairDisplay-Bold.ttf', italic: 'playfair-display/PlayfairDisplay-Italic.ttf', boldItalic: 'playfair-display/PlayfairDisplay-BoldItalic.ttf' },
    subset: true, ascent: 1.082, descent: 0.251, scripts: NOTO_SCRIPTS, licenseFile: 'playfair-display/OFL.txt',
  },
  {
    id: 'DancingScript', label: 'Dancing Script', kind: 'bundled', category: 'handwriting',
    cssFamily: 'FT Dancing Script', cssFallback: 'cursive',
    files: { regular: 'dancing-script/DancingScript-Regular.ttf', bold: 'dancing-script/DancingScript-Bold.ttf' },
    subset: true, ascent: 0.92, descent: 0.28, scripts: 'Latin, Latin Extended, Vietnamese', licenseFile: 'dancing-script/OFL.txt',
  },
  {
    id: 'Caveat', label: 'Caveat', kind: 'bundled', category: 'handwriting',
    cssFamily: 'FT Caveat', cssFallback: 'cursive',
    files: { regular: 'caveat/Caveat-Regular.ttf', bold: 'caveat/Caveat-Bold.ttf' },
    subset: false, ascent: 0.96, descent: 0.3, scripts: 'Latin, Latin Extended, Cyrillic', licenseFile: 'caveat/OFL.txt',
  },
];

const BY_ID = new Map(FONT_FAMILIES.map((f) => [f.id, f]));

export function fontDef(id: FontId): FontFamilyDef {
  return BY_ID.get(id) ?? BY_ID.get('Helvetica')!;
}

export function isFontId(v: unknown): v is FontId {
  return typeof v === 'string' && BY_ID.has(v as FontId);
}

export function isStandard(id: FontId): boolean {
  return fontDef(id).kind === 'standard';
}

/** Unicode substitute for a standard font when text has non-WinAnsi characters. */
export const NOTO_EQUIVALENT: Record<'Helvetica' | 'Times' | 'Courier', FontId> = {
  Helvetica: 'NotoSans',
  Times: 'NotoSerif',
  Courier: 'NotoSansMono',
};

export function unicodeEquivalent(id: FontId): FontId {
  return id === 'Helvetica' || id === 'Times' || id === 'Courier' ? NOTO_EQUIVALENT[id] : id;
}

export function variantKey(bold: boolean, italic: boolean): VariantKey {
  return bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular';
}

export interface ResolvedVariant {
  key: VariantKey;
  bold: boolean;
  italic: boolean;
  /** Styles requested but not available in this family (rendered without them). */
  missing: ('bold' | 'italic')[];
}

/**
 * Pick the closest available variant. Families without italics render upright
 * (no fake slant) — consistently on screen, in canvas and in the PDF.
 */
export function resolveVariant(id: FontId, bold: boolean, italic: boolean): ResolvedVariant {
  const def = fontDef(id);
  if (def.kind === 'standard') return { key: variantKey(bold, italic), bold, italic, missing: [] };
  const has = (k: VariantKey) => Boolean(def.files[k]);
  const want = variantKey(bold, italic);
  if (has(want)) return { key: want, bold, italic, missing: [] };
  const missing: ('bold' | 'italic')[] = [];
  let b = bold;
  let i = italic;
  if (i && !has(variantKey(b, true))) {
    i = false;
    missing.push('italic');
  }
  if (b && !has(variantKey(true, i))) {
    b = false;
    missing.push('bold');
  }
  return { key: variantKey(b, i), bold: b, italic: i, missing };
}

export function cssFontFamily(id: FontId): string {
  const def = fontDef(id);
  return `"${def.cssFamily}", ${def.cssFallback}`;
}

/** OpenType features turned off for vector text: keeps one glyph per character, so the
 *  PDF's ToUnicode map (copy/paste, search) stays correct, and screen/PDF widths agree. */
export const NO_SUBSTITUTION_FEATURES = { liga: false, clig: false, dlig: false, hlig: false, calt: false, rlig: false, salt: false, swsh: false } as const;

/** CSS equivalent of NO_SUBSTITUTION_FEATURES, for vector text boxes on screen. */
export const CSS_NO_SUBSTITUTION = `"liga" 0, "clig" 0, "dlig" 0, "hlig" 0, "calt" 0, "salt" 0, "swsh" 0`;
