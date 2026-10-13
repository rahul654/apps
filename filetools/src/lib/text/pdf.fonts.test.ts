/**
 * Rich text → PDF with the real bundled fonts, checked with pdf.js in Node.
 * Rendering checks use @napi-rs/canvas (an optional dependency of pdfjs-dist); they are
 * skipped if it isn't installed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FONT_FAMILIES, NO_SUBSTITUTION_FEATURES, fontDef, type FontId, type VariantKey } from '../fonts/registry';
import type { TextObj } from '../pdf/editorModel';
import { applyEdits } from '../pdf/editorSave';
import type { TextSaveDeps } from './boxWriter';
import { layoutText } from './layout';
import { vectorMeasure } from './measure';
import { DEFAULT_MARKS, makeParagraph, type Paragraph, type RunMarks } from './model';
import { rasterizeTextBox, type CanvasEnv } from './rasterize';

type NapiCanvas = { createCanvas(w: number, h: number): { width: number; height: number; getContext(t: '2d'): unknown; encode(f: 'png'): Promise<Uint8Array> } };
let napi: NapiCanvas | null = null;

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  try {
    napi = (await import('@napi-rs/canvas' as string)) as NapiCanvas;
  } catch {
    napi = null;
  }
});

const fontPath = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const fontBytes = async (font: FontId, variant: VariantKey) => new Uint8Array(readFileSync(fontPath(fontDef(font).files[variant]!)));

const TINY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function deps(): TextSaveDeps {
  const env: CanvasEnv | null = napi
    ? { create: (w, h) => napi!.createCanvas(w, h), toPng: async (c) => new Uint8Array(await (c as ReturnType<NapiCanvas['createCanvas']>).encode('png')) }
    : null;
  return {
    fontkit,
    fontBytes,
    rasterize: async (req) => (env ? rasterizeTextBox(req, env) : { image: { bytes: TINY_PNG, format: 'png', width: 1, height: 1 }, height: 20 }),
  };
}

const M = (p: Partial<RunMarks> = {}): RunMarks => ({ ...DEFAULT_MARKS, size: 16, ...p });
const box = (paragraphs: Paragraph[], extra: Partial<TextObj> = {}): TextObj => ({ id: 'b', page: 0, type: 'text', x: 40, y: 40, w: 400, paragraphs, background: null, padding: 4, opacity: 1, ...extra });

async function open(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
}

async function pageText(bytes: Uint8Array, n = 1): Promise<string> {
  const pdf = await open(bytes);
  const tc = await (await pdf.getPage(n)).getTextContent();
  await pdf.destroy();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join('');
}

function pageResources(doc: PDFDocument, n = 0): { fonts: number; images: number; content: string } {
  const page = doc.getPage(n);
  const res = page.node.Resources();
  const fontDict = res?.lookup(PDFName.of('Font'));
  const xobj = res?.lookup(PDFName.of('XObject'));
  let images = 0;
  if (xobj instanceof PDFDict) {
    for (const [, v] of xobj.entries()) {
      const o = v instanceof PDFRef ? doc.context.lookup(v) : v;
      if (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') images++;
    }
  }
  let content = '';
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  for (const s of streams) {
    const o = s instanceof PDFRef ? doc.context.lookup(s) : s;
    if (o instanceof PDFRawStream) content += new TextDecoder('latin1').decode(decodePDFRawStream(o).decode()) + '\n';
  }
  return { fonts: fontDict instanceof PDFDict ? fontDict.keys().length : 0, images, content };
}

async function blankPdf(rotation = 0): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([500, 400]).setRotation(degrees(rotation));
  return d.save();
}

describe('rich text boxes with bundled fonts', () => {
  it('mixed bold/italic Noto Sans runs plus Cyrillic: real text, several fonts embedded', async () => {
    const paragraphs: Paragraph[] = [
      {
        runs: [
          { text: 'Hello ', marks: M({ font: 'NotoSans' }) },
          { text: 'bold ', marks: M({ font: 'NotoSans', bold: true }) },
          { text: 'italic ', marks: M({ font: 'NotoSans', italic: true }) },
          { text: 'Привет мир', marks: M({ font: 'Helvetica' }) }, // → substituted with Noto Sans
        ],
        align: 'start',
        lineHeight: 1.15,
      },
    ];
    const res = await applyEdits(await blankPdf(), { objects: [box(paragraphs)], images: {} }, deps());
    expect(res.textBoxes[0]).toMatchObject({ kind: 'vector' });
    expect(res.textBoxes[0].note).toMatch(/Noto Sans instead of Helvetica/);
    expect((await pageText(res.bytes)).replace(/\s+/g, ' ').trim()).toBe('Hello bold italic Привет мир');
    const doc = await PDFDocument.load(res.bytes);
    const r = pageResources(doc);
    expect(r.fonts).toBeGreaterThan(1);
    expect(r.images).toBe(0);
  });

  it('places vector text where the layout says, on a rotated page', async () => {
    const paragraphs = [makeParagraph('Tiếng Việt', M({ font: 'NotoSerif' }))];
    const b = box(paragraphs, { x: 60, y: 50 });
    const res = await applyEdits(await blankPdf(90), { objects: [b], images: {} }, deps());
    const fk = fontkit.create(await fontBytes('NotoSerif', 'regular'));
    const layout = layoutText(paragraphs, { width: b.w, padding: b.padding }, vectorMeasure((f) => (f === 'NotoSerif' ? fk : undefined)));
    const pdf = await open(res.bytes);
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const item = (await page.getTextContent()).items.find((i) => 'str' in i && i.str.length > 0);
    if (!item || !('transform' in item)) throw new Error('no text');
    const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
    expect(x).toBeCloseTo(60 + 4, 2);
    expect(y).toBeCloseTo(50 + layout.lines[0].baseline, 2);
    // Width in the PDF matches the layout width (same advances on screen and in the PDF).
    expect(item.width).toBeCloseTo(layout.lines[0].contentWidth, 1);
    await pdf.destroy();
  });

  it('a Hindi box is saved as one image XObject, with no text operators', async () => {
    const paragraphs = [makeParagraph('नमस्ते दुनिया', M({ font: 'NotoSans' }))];
    const res = await applyEdits(await blankPdf(), { objects: [box(paragraphs)], images: {} }, deps());
    expect(res.textBoxes[0]).toMatchObject({ kind: 'raster' });
    expect(res.textBoxes[0].note).toMatch(/Saves as image/);
    const r = pageResources(await PDFDocument.load(res.bytes));
    expect(r.images).toBe(1);
    expect(r.content).not.toMatch(/\b(Tj|TJ)\b/);
    expect(r.content).toMatch(/\bDo\b/);
    expect(await pageText(res.bytes)).toBe('');
  });

  it('rasterises with a real canvas when available (pixels drawn, size at 300 dpi)', async () => {
    if (!napi) return; // @napi-rs/canvas not installed
    const env: CanvasEnv = { create: (w, h) => napi!.createCanvas(w, h), toPng: async (c) => new Uint8Array(await (c as ReturnType<NapiCanvas['createCanvas']>).encode('png')) };
    const r = await rasterizeTextBox({ paragraphs: [makeParagraph('नमस्ते', M({ size: 20 }))], width: 100, padding: 0, background: null, dpi: 300 }, env);
    expect(r.image.width).toBe(Math.ceil(100 * (300 / 72)));
    expect(r.height).toBeGreaterThan(20);
    expect(r.image.bytes.length).toBeGreaterThan(200);
  });
});

describe('bundled font embedding settings', () => {
  // pdf-lib's subsetter drops glyphs for some fonts; registry.subset is only true where the
  // subset renders identically to the full font. Verify by rendering both with pdf.js.
  const sample = 'The quick brown fox — Жизнь Ωμέγα Tiếng Việt 123';

  async function render(bytes: Uint8Array): Promise<Uint8ClampedArray> {
    const pdf = await open(bytes);
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1.5 });
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { context: CanvasRenderingContext2D } } }).canvasFactory;
    const { context } = factory.create(vp.width, vp.height);
    await page.render({ canvasContext: context, viewport: vp }).promise;
    const data = context.getImageData(0, 0, vp.width, vp.height).data;
    await pdf.destroy();
    return data;
  }

  async function embedSample(bytes: Uint8Array, subset: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(bytes, { subset, features: { ...NO_SUBSTITUTION_FEATURES } });
    const fk = fontkit.create(bytes);
    const text = [...sample].filter((c) => c === ' ' || fk.hasGlyphForCodePoint(c.codePointAt(0)!)).join('');
    doc.addPage([700, 80]).drawText(text, { x: 10, y: 30, size: 22, font });
    return doc.save();
  }

  for (const def of FONT_FAMILIES.filter((f) => f.kind === 'bundled')) {
    it(`${def.label}: ${def.subset ? 'subset' : 'full'} embedding renders correctly`, async () => {
      const bytes = await fontBytes(def.id, 'regular');
      const chosen = await embedSample(bytes, def.subset);
      expect((await pageText(chosen)).length).toBeGreaterThan(10);
      if (!napi) return;
      const ink = (d: Uint8ClampedArray) => d.reduce((n, v, i) => (i % 4 === 0 && v < 128 ? n + 1 : n), 0);
      const a = await render(chosen);
      expect(ink(a)).toBeGreaterThan(500);
      if (def.subset) {
        let full: Uint8Array | null = null;
        try {
          full = await embedSample(bytes, false);
        } catch {
          full = null; // e.g. Dancing Script: pdf-lib's full embedding crashes on one glyph
        }
        if (full) {
          const b = await render(full);
          let diff = 0;
          for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 40) diff++;
          expect(diff / Math.max(1, ink(b))).toBeLessThan(0.02);
        }
      }
    });
  }
});

describe('form fields in any language', () => {
  async function formPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const form = doc.getForm();
    form.createTextField('ru').addToPage(page, { x: 20, y: 300, width: 200, height: 24 });
    form.createTextField('hi').addToPage(page, { x: 20, y: 250, width: 200, height: 24 });
    return doc.save();
  }

  it('Cyrillic values get a Noto Sans appearance; flattened text is extractable', async () => {
    const res = await applyEdits(await formPdf(), { objects: [], images: {}, formValues: { ru: 'Привет' }, flattenForm: true }, deps());
    expect(res.warnings).toEqual([]);
    expect(await pageText(res.bytes)).toContain('Привет');
  });

  it('complex-script values without flattening: value kept, appearance removed, NeedAppearances set, warning', async () => {
    const res = await applyEdits(await formPdf(), { objects: [], images: {}, formValues: { hi: 'नमस्ते' } }, deps());
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getForm().getTextField('hi').getText()).toBe('नमस्ते');
    expect(doc.getForm().acroForm.dict.get(PDFName.of('NeedAppearances'))).toBe(PDFBool.True);
    expect(doc.getForm().getTextField('hi').acroField.getWidgets()[0].dict.get(PDFName.of('AP'))).toBeUndefined();
    expect(res.warnings.join(' ')).toMatch(/Devanagari/);
  });

  it('complex-script values with flattening are rasterised into the page', async () => {
    const res = await applyEdits(await formPdf(), { objects: [], images: {}, formValues: { hi: 'नमस्ते', ru: 'Да' }, flattenForm: true }, deps());
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(pageResources(doc).images).toBe(1);
    expect(res.warnings.join(' ')).toMatch(/flattened as an image/);
    expect(await pageText(res.bytes)).toContain('Да');
  });
});
