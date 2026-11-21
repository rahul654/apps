/**
 * Integration tests: real PDFs built with pdf-lib, checked with pdf-lib and pdf.js
 * (the same renderer the app uses) running in Node.
 */
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeRotation, pdfToDisplay, type PageRotation } from '../coords';
import { layoutText } from '../text/layout';
import { vectorMeasure } from '../text/measure';
import { DEFAULT_MARKS, makeParagraph } from '../text/model';
import type { EditorObject, TextObj } from './editorModel';
import { applyEdits, listFormFields, replacePagesWithImages } from './editorSave';
import { addPageNumbers, addWatermark, buildFromPlan, layoutImageOnPage, loadPdf, PdfUserError, readMetadata, splitPdf, stripMetadata, writeMetadata } from './ops';

beforeAll(async () => {
  // Registers globalThis.pdfjsWorker so pdf.js uses its in-process "fake worker".
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
});

async function openWithPdfjs(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
}

const TINY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** 3 pages: 200×300 "A", 300×200 "B", 400×400 "C". */
async function threePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes: [number, number][] = [[200, 300], [300, 200], [400, 400]];
  ['A', 'B', 'C'].forEach((label, i) => {
    const page = doc.addPage(sizes[i]);
    page.drawText(`Page ${label}`, { x: 20, y: 20, size: 12, font });
  });
  doc.setTitle('Three pages');
  doc.setAuthor('Tester');
  return doc.save();
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await openWithPdfjs(bytes);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').trim());
  }
  await doc.destroy();
  return out;
}

describe('organize / split', () => {
  it('reorders, rotates, deletes and inserts pages', async () => {
    const src = await threePagePdf();
    // New order: C (rotated 90), A, blank — page B deleted.
    const out = await buildFromPlan(src, [
      { kind: 'page', index: 2, rotate: 90 },
      { kind: 'page', index: 0 },
      { kind: 'blank', width: 612, height: 792 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => normalizeRotation(p.getRotation().angle))).toEqual([90, 0, 0]);
    expect(doc.getPage(1).getSize()).toEqual({ width: 200, height: 300 });
    expect(doc.getPage(2).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getTitle()).toBe('Three pages');
    expect(await pageTexts(out)).toEqual(['Page C', 'Page A', '']);
  });

  it('adds rotation on top of an existing rotation and duplicates pages', async () => {
    const d = await PDFDocument.create();
    d.addPage([100, 100]).setRotation(degrees(270));
    const out = await buildFromPlan(await d.save(), [
      { kind: 'page', index: 0, rotate: 180 },
      { kind: 'page', index: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => normalizeRotation(p.getRotation().angle))).toEqual([90, 270]);
  });

  it('splits into groups', async () => {
    const parts = await splitPdf(await threePagePdf(), [[0, 1], [2]]);
    expect(parts).toHaveLength(2);
    expect(await pageTexts(parts[0])).toEqual(['Page A', 'Page B']);
    expect(await pageTexts(parts[1])).toEqual(['Page C']);
  });

  it('rejects an empty plan and bad indices', async () => {
    const src = await threePagePdf();
    await expect(buildFromPlan(src, [])).rejects.toBeInstanceOf(PdfUserError);
    await expect(buildFromPlan(src, [{ kind: 'page', index: 5 }])).rejects.toThrow(/doesn’t exist/);
  });

  it('gives a friendly error for non-PDF bytes', async () => {
    await expect(loadPdf(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('coordinate mapping matches pdf.js viewports', () => {
  it('pdfToDisplay equals viewport.convertToViewportPoint for all rotations', async () => {
    const doc = await PDFDocument.create();
    for (const r of [0, 90, 180, 270]) {
      const page = doc.addPage([300, 200]);
      page.setMediaBox(10, 20, 300, 200); // non-zero origin
      page.setRotation(degrees(r));
    }
    const pdf = await openWithPdfjs(await doc.save());
    for (let i = 1; i <= 4; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const [x0, y0, x1, y1] = page.view;
      const geom = { x0, y0, width: x1 - x0, height: y1 - y0, rotation: normalizeRotation(page.rotate) as PageRotation };
      for (const [px, py] of [[10, 20], [310, 220], [100, 50], [250.5, 199]]) {
        const [vx, vy] = vp.convertToViewportPoint(px, py);
        const d = pdfToDisplay(geom, px, py);
        expect(d.x).toBeCloseTo(vx, 6);
        expect(d.y).toBeCloseTo(vy, 6);
      }
    }
    await pdf.destroy();
  });
});

describe('editor save', () => {
  /** Where pdf.js says a text item's baseline origin is, in display space. */
  async function textPositions(bytes: Uint8Array, pageNo: number) {
    const pdf = await openWithPdfjs(bytes);
    const page = await pdf.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const out = tc.items.flatMap((it) => {
      if (!('str' in it) || !it.str.trim()) return [];
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      return [{ str: it.str, x, y, transform: it.transform }];
    });
    await pdf.destroy();
    return out;
  }

  it('writes text at the right display position on rotated pages', async () => {
    const doc = await PDFDocument.create();
    for (const r of [0, 90, 180, 270]) doc.addPage([400, 300]).setRotation(degrees(r));
    const src = await doc.save();
    const marks = { ...DEFAULT_MARKS, size: 20, color: '#112233' };
    const objects: TextObj[] = [0, 1, 2, 3].map((page) => ({
      id: `t${page}`, page, type: 'text', x: 50, y: 40, w: 200, paragraphs: [makeParagraph('Hello', marks)], background: null, padding: 4, opacity: 1,
    }));
    const { bytes, securePages, textBoxes } = await applyEdits(src, { objects, images: {} });
    expect(securePages).toEqual([]);
    expect(textBoxes.map((t) => t.kind)).toEqual(['vector', 'vector', 'vector', 'vector']);
    const layout = layoutText(objects[0].paragraphs, { width: 200, padding: 4 }, vectorMeasure(() => undefined));
    for (let p = 0; p < 4; p++) {
      const items = await textPositions(bytes, p + 1);
      expect(items).toHaveLength(1);
      expect(items[0].str).toBe('Hello');
      expect(items[0].x).toBeCloseTo(54, 3);
      expect(items[0].y).toBeCloseTo(40 + layout.lines[0].baseline, 3);
    }
  });

  it('draws shapes, lines, paths and images without errors and keeps page count', async () => {
    const src = await threePagePdf();
    const objects: EditorObject[] = [
      { id: 'r', page: 0, type: 'rect', x: 10, y: 10, w: 50, h: 20, stroke: '#ff0000', fill: '#00ff00', strokeWidth: 2, opacity: 0.5 },
      { id: 'e', page: 1, type: 'ellipse', x: 10, y: 10, w: 50, h: 20, stroke: '#000000', fill: null, strokeWidth: 1, opacity: 1 },
      { id: 'l', page: 1, type: 'line', x1: 0, y1: 0, x2: 100, y2: 50, color: '#0000ff', width: 3, arrow: true, opacity: 1 },
      { id: 'p', page: 2, type: 'path', points: [0, 0, 10, 10, 20, 5, 30, 30], color: '#ffff00', width: 12, opacity: 0.4, highlighter: true },
      { id: 'i', page: 2, type: 'image', x: 100, y: 100, w: 30, h: 30, imageId: 'png1', signature: true },
      { id: 'c', page: 0, type: 'cover', x: 15, y: 270, w: 60, h: 20, color: 'white', secure: false },
    ];
    const { bytes } = await applyEdits(src, { objects, images: { png1: { bytes: TINY_PNG, format: 'png', width: 1, height: 1 } } });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    // Cover boxes only hide visually — the original text is still extractable.
    expect((await pageTexts(bytes))[0]).toBe('Page A');
  });

  it('never blocks saving: a box that needs rasterising but has no rasteriser is reported', async () => {
    const src = await threePagePdf();
    const t: TextObj = { id: 'x', page: 0, type: 'text', x: 1, y: 1, w: 100, paragraphs: [makeParagraph('नमस्ते', DEFAULT_MARKS)], background: null, padding: 0, opacity: 1 };
    const res = await applyEdits(src, { objects: [t], images: {} });
    expect(res.textBoxes[0]).toMatchObject({ kind: 'skipped' });
    expect(res.warnings.join(' ')).toMatch(/image/);
  });

  it('secure redaction replaces the page and removes its text from the file', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 200]).drawText('KEEP', { x: 10, y: 10, font, size: 10 });
    const secret = doc.addPage([300, 200]);
    secret.setRotation(degrees(90));
    secret.drawText('SECRET-NUMBER-123', { x: 10, y: 10, font, size: 10 });
    const src = await doc.save();
    const { bytes, securePages } = await applyEdits(src, {
      objects: [{ id: 'c', page: 1, type: 'cover', x: 0, y: 0, w: 50, h: 50, color: 'black', secure: true }],
      images: {},
    });
    expect(securePages).toEqual([1]);
    const out = await replacePagesWithImages(bytes, new Map([[1, { bytes: TINY_PNG, format: 'png' as const, width: 1, height: 1 }]]));
    const res = await PDFDocument.load(out);
    expect(res.getPageCount()).toBe(2);
    // Displayed size kept (rotated 300×200 shows as 200×300), rotation baked in.
    expect(res.getPage(1).getSize()).toEqual({ width: 200, height: 300 });
    expect(res.getPage(1).getRotation().angle).toBe(0);
    expect(await pageTexts(out)).toEqual(['KEEP', '']);
    // No stream anywhere in the file still contains the secret.
    for (const [, obj] of res.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        const text = new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
        expect(text).not.toContain('SECRET');
      }
    }
  });
});

describe('forms', () => {
  async function formPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    page.setRotation(degrees(90));
    const form = doc.getForm();
    form.createTextField('name').addToPage(page, { x: 50, y: 300, width: 200, height: 24 });
    form.createCheckBox('agree').addToPage(page, { x: 50, y: 250, width: 16, height: 16 });
    const radio = form.createRadioGroup('size');
    radio.addOptionToPage('S', page, { x: 50, y: 200, width: 14, height: 14 });
    radio.addOptionToPage('L', page, { x: 80, y: 200, width: 14, height: 14 });
    const dd = form.createDropdown('country');
    dd.addOptions(['India', 'UAE']);
    dd.addToPage(page, { x: 50, y: 150, width: 120, height: 20 });
    return doc.save();
  }

  it('detects fields with display-space rects', async () => {
    const fields = await listFormFields(await formPdf());
    expect(fields.map((f) => f.type).sort()).toEqual(['checkbox', 'dropdown', 'radio', 'radio', 'text']);
    const name = fields.find((f) => f.name === 'name')!;
    // Page is 400×400 rotated 90: PDF (x, y) → display (y, x).
    // (pdf-lib grows widget rects by half the 1pt border on each side.)
    expect(name.rect.x).toBeCloseTo(299.5);
    expect(name.rect.y).toBeCloseTo(49.5);
    expect(name.rect.w).toBeCloseTo(25);
    expect(name.rect.h).toBeCloseTo(201);
    expect(fields.filter((f) => f.type === 'radio').map((f) => f.option)).toEqual(['S', 'L']);
    expect(fields.find((f) => f.name === 'country')!.options).toEqual(['India', 'UAE']);
  });

  it('fills and flattens', async () => {
    const src = await formPdf();
    const { bytes, warnings } = await applyEdits(src, {
      objects: [],
      images: {},
      formValues: { name: 'Asha', agree: true, size: 'L', country: 'UAE' },
      flattenForm: false,
    });
    expect(warnings).toEqual([]);
    const filled = (await PDFDocument.load(bytes)).getForm();
    expect(filled.getTextField('name').getText()).toBe('Asha');
    expect(filled.getCheckBox('agree').isChecked()).toBe(true);
    expect(filled.getRadioGroup('size').getSelected()).toBe('L');
    expect(filled.getDropdown('country').getSelected()).toEqual(['UAE']);

    // Changing a pre-filled value must not leave the old value's appearance in the file.
    const refill = await applyEdits(bytes, { objects: [], images: {}, formValues: { name: 'Zed' } });
    let all = '';
    for (const [, obj] of (await PDFDocument.load(refill.bytes)).context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) all += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
    }
    expect(all).toContain('<5A6564> Tj'); // "Zed"
    expect(all).not.toContain('<41736861>'); // "Asha" gone

    const flat = await applyEdits(src, { objects: [], images: {}, formValues: { name: 'Asha' }, flattenForm: true });
    expect((await PDFDocument.load(flat.bytes)).getForm().getFields()).toHaveLength(0);
    expect((await pageTexts(flat.bytes))[0]).toContain('Asha');
  });
});

describe('stamps and metadata', () => {
  it('adds page numbers upright at the bottom centre, also on rotated pages', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    doc.addPage([300, 400]).setRotation(degrees(90));
    const out = await addPageNumbers(await doc.save(), { format: 'Page {n} of {total}', position: 'bottom-center', startAt: 1, fontSize: 10, marginPt: 20 });
    const pdf = await openWithPdfjs(out);
    for (let i = 1; i <= 2; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const item = (await page.getTextContent()).items.find((it) => 'str' in it && it.str.startsWith('Page'));
      expect(item && 'str' in item && item.str).toBe(`Page ${i} of 2`);
      if (!item || !('transform' in item)) throw new Error('no text');
      const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
      expect(y).toBeCloseTo(vp.height - 20, 3); // baseline 20pt above the displayed bottom
      expect(x).toBeGreaterThan(vp.width / 2 - 60);
      expect(x).toBeLessThan(vp.width / 2);
    }
    await pdf.destroy();
  });

  it('adds a watermark to every page', async () => {
    const out = await addWatermark(await threePagePdf(), { text: 'DRAFT', fontSize: 40, opacity: 0.2, angle: 45, position: 'center', color: [0.5, 0.5, 0.5] });
    const texts = await pageTexts(out);
    expect(texts.every((t) => t.includes('DRAFT'))).toBe(true);
  });

  it('edits and strips metadata', async () => {
    const src = await threePagePdf();
    expect((await readMetadata(src)).title).toBe('Three pages');
    const edited = await writeMetadata(src, { title: 'New', author: '', subject: 'S', keywords: 'a, b', creator: '', producer: '' });
    const m = await readMetadata(edited);
    expect(m).toMatchObject({ title: 'New', author: '', subject: 'S', hasXmp: false });
    expect(m.keywords).toContain('a');
    const stripped = await readMetadata(await stripMetadata(src));
    expect(stripped).toMatchObject({ title: '', author: '', producer: '', creator: '', pageCount: 3 });
    expect(stripped.creationDate).toBeUndefined();
  });

  it('lays out images on pages', () => {
    const fit = layoutImageOnPage(800, 600, 'fit', 'auto', 10);
    expect(fit).toEqual({ pageWidth: 620, pageHeight: 470, x: 10, y: 10, width: 600, height: 450 });
    const a4 = layoutImageOnPage(4000, 3000, 'A4', 'auto', 36);
    expect(a4.pageWidth).toBeCloseTo(841.89); // landscape picked automatically
    expect(a4.height).toBeCloseTo(595.28 - 72); // height-limited (4:3 in a 770×523 box)
    expect(a4.width).toBeCloseTo((595.28 - 72) * (4 / 3));
    const small = layoutImageOnPage(100, 100, 'A4', 'portrait', 0);
    expect(small.width).toBe(75); // never upscaled
    expect(small.x).toBeCloseTo((595.28 - 75) / 2);
  });
});
