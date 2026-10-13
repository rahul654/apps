import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { displayToPdf, normalizeRotation, type PageGeometry, type PageRotation } from '../coords';
import { BUNDLED_FAST, cacheKeyFor, langString, parseCacheKey, resolveLangAssets } from './langs';
import { bestRotation, binarize, clampFactor, contrastStretch, histogram, median, otsuThreshold, preprocessPixels, toGrayscale, upscaleFactor } from './preprocess';
import { fromTesseract, hasMeaningfulText, linesToDisplay, similarity, textFromLines, weightedConfidence, type OcrLine } from './result';
import { recognizeOriented, needsOrientationCheck, orientationScore, wideFraction } from './orient';
import { addInvisibleTextLayer, placeQuad, quadsFromOcrLines, renderPixelMapper, rotatePixel, utf16Hex, type QuarterTurn } from './textLayer';
import { pageGeometry } from '../pdf/ops';
import { pdfToDisplay } from '../coords';
import type { OcrPage } from './result';

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
});

const open = (bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;

describe('preprocessing maths', () => {
  it('converts to grayscale with luma weights; transparent → white', () => {
    const img = { width: 3, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]) };
    expect([...toGrayscale(img)]).toEqual([76, 29, 255]);
  });

  it('finds the Otsu threshold between two clusters', () => {
    const gray = new Uint8ClampedArray([...Array(50).fill(30), ...Array(50).fill(200)]);
    const t = otsuThreshold(histogram(gray));
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(200);
    expect([...binarize(gray, t)].slice(48, 52)).toEqual([0, 0, 255, 255]);
  });

  it('Otsu on a noisy bimodal image separates the clusters', () => {
    const gray = new Uint8ClampedArray(1000);
    for (let i = 0; i < 1000; i++) gray[i] = i < 300 ? 40 + (i % 20) : 180 + (i % 30);
    const t = otsuThreshold(histogram(gray));
    expect(t).toBeGreaterThanOrEqual(59);
    expect(t).toBeLessThan(180);
    expect(otsuThreshold(new Array(256).fill(0))).toBe(127);
  });

  it('stretches contrast to the full range', () => {
    const gray = new Uint8ClampedArray([100, 110, 120, 130, 140, 150]);
    const out = contrastStretch(gray, 0);
    expect(out[0]).toBe(0);
    expect(out[5]).toBe(255);
    expect(out[2]).toBe(102);
    expect([...contrastStretch(new Uint8ClampedArray([7, 7, 7]))]).toEqual([7, 7, 7]);
  });

  it('runs the enabled steps only', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([10, 10, 10, 255, 240, 240, 240, 255]) };
    expect(preprocessPixels(img, { grayscale: false, contrast: false, binarize: false }).image).toBe(img);
    const bin = preprocessPixels(img, { grayscale: true, contrast: true, binarize: true });
    expect([...bin.image.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('upscale factor for small text, clamped by pixel budget', () => {
    expect(upscaleFactor(30)).toBe(1);
    expect(upscaleFactor(20)).toBe(1);
    expect(upscaleFactor(12)).toBe(3);
    expect(upscaleFactor(5)).toBe(4);
    expect(upscaleFactor(0)).toBe(1);
    expect(clampFactor(3000, 3000, 3, 16_000_000)).toBe(1);
    expect(clampFactor(1000, 1000, 3)).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('picks the best trial rotation', () => {
    expect(bestRotation([{ rotation: 0, confidence: 30, chars: 5 }, { rotation: 90, confidence: 85, chars: 120 }, { rotation: 180, confidence: 40, chars: 80 }, { rotation: 270, confidence: 20, chars: 3 }])).toBe(90);
  });
});

describe('languages', () => {
  const bundled = { eng: './assets/eng.gz', hin: './assets/hin.gz' };
  it('bundled vs remote, per model', () => {
    const fast = resolveLangAssets(['eng', 'hin', 'fra'], 'fast', bundled);
    expect(fast.map((a) => [a.code, a.source])).toEqual([['eng', 'bundled'], ['hin', 'bundled'], ['fra', 'remote']]);
    expect(fast[0].url).toBe('./assets/eng.gz');
    expect(fast[2].url).toBe('https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0/fra.traineddata');
    const best = resolveLangAssets(['eng', 'chi_sim'], 'best', bundled);
    expect(best.every((a) => a.source === 'remote')).toBe(true);
    expect(best[1].url).toBe('https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz');
    expect(best[1].cacheKey).toBe('best/chi_sim.traineddata');
  });
  it('dedupes, rejects unknown codes, builds lang strings and parses cache keys', () => {
    expect(resolveLangAssets(['eng', 'eng'], 'fast', bundled)).toHaveLength(1);
    expect(() => resolveLangAssets(['xx'], 'fast', bundled)).toThrow();
    expect(langString(['eng', 'hin', 'eng'])).toBe('eng+hin');
    expect(cacheKeyFor('hin', 'fast')).toBe('fast/hin.traineddata');
    expect(parseCacheKey('fast/chi_tra.traineddata')).toEqual({ model: 'fast', code: 'chi_tra' });
    expect(parseCacheKey('./eng.traineddata')).toBeNull();
    expect(BUNDLED_FAST).toEqual(['eng', 'hin']);
  });
});

describe('results', () => {
  const lines: OcrLine[] = [
    { bbox: { x0: 0, y0: 0, x1: 100, y1: 20 }, words: [{ text: 'Hello', confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }, { text: 'world', confidence: 70, bbox: { x0: 60, y0: 0, x1: 100, y1: 20 } }] },
    { bbox: { x0: 0, y0: 30, x1: 50, y1: 50 }, words: [{ text: 'नमस्ते', confidence: 50, bbox: { x0: 0, y0: 30, x1: 50, y1: 50 } }] },
  ];
  it('builds text with word offsets and a weighted confidence', () => {
    const t = textFromLines(lines);
    expect(t.text).toBe('Hello world\nनमस्ते');
    expect(t.offsets.map((o) => t.text.slice(o.start, o.end))).toEqual(['Hello', 'world', 'नमस्ते']);
    expect(weightedConfidence(lines)).toBeCloseTo((90 * 5 + 70 * 5 + 50 * 6) / 16, 1);
  });
  it('converts tesseract.js output and drops empty words', () => {
    const page = fromTesseract({ text: 'x', blocks: [{ paragraphs: [{ lines: [{ bbox: lines[0].bbox, words: [...lines[0].words, { text: ' ', confidence: 0, bbox: lines[0].bbox }] }] }] }] }, 100, 50);
    expect(page.lines[0].words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(page.width).toBe(100);
  });
  it('detects pages that already have real text', () => {
    expect(hasMeaningfulText([{ str: 'Annual report 2024' }])).toBe(true);
    expect(hasMeaningfulText([{ str: '   ' }, { str: '-- 3 --' }])).toBe(false);
    expect(hasMeaningfulText([])).toBe(false);
    expect(hasMeaningfulText([{ str: 'नमस्ते दुनिया आज' }])).toBe(true);
  });
  it('similarity', () => {
    expect(similarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7);
    expect(similarity('', '')).toBe(1);
  });
});

/** PDF with an offset/cropped box at each rotation. */
async function rotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const r of [0, 90, 180, 270]) {
    const p = doc.addPage([400, 300]);
    p.setMediaBox(-20, 30, 400, 300);
    p.setCropBox(-10, 40, 380, 280);
    p.setRotation(degrees(r));
  }
  return doc.save();
}

describe('pixel box → PDF user space', () => {
  it('matches pdf.js viewport.convertToPdfPoint at render scale, all rotations, cropped/offset boxes', async () => {
    const pdf = await open(await rotatedPdf());
    const scale = 300 / 72;
    for (let i = 1; i <= 4; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale });
      const [x0, y0, x1, y1] = page.view;
      const g: PageGeometry = { x0, y0, width: x1 - x0, height: y1 - y0, rotation: normalizeRotation(page.rotate) as PageRotation };
      for (const [px, py] of [[0, 0], [123, 456], [vp.width, vp.height], [800.5, 10]]) {
        const [ex, ey] = vp.convertToPdfPoint(px, py);
        const d = linesToDisplay([{ bbox: { x0: px, y0: py, x1: px, y1: py }, words: [{ text: 'x', confidence: 0, bbox: { x0: px, y0: py, x1: px, y1: py } }] }], scale)[0].words[0];
        const p = displayToPdf(g, d.x0, d.y0);
        expect(p.x).toBeCloseTo(ex, 6);
        expect(p.y).toBeCloseTo(ey, 6);
      }
    }
    await pdf.destroy();
  });
});

describe('invisible text layer', () => {
  const TINY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

  it('UTF-16 encodes code units (surrogate pairs included)', () => {
    expect(utf16Hex('Aन')).toEqual({ hex: '00410928', units: 2 });
    expect(utf16Hex('😀').hex).toBe('D83DDE00');
  });

  it('places words with trailing spaces and stretch to the next word', () => {
    const g: PageGeometry = { x0: 0, y0: 0, width: 200, height: 100, rotation: 0 };
    const quads = quadsFromOcrLines([{ words: [{ text: 'ab', bbox: { x0: 10, y0: 10, x1: 30, y1: 20 } }, { text: 'cd', bbox: { x0: 40, y0: 10, x1: 60, y1: 20 } }] }], renderPixelMapper(g, 1, 200, 100));
    const placed = quads.map(placeQuad);
    expect(placed.map((p) => p?.text)).toEqual(['ab ', 'cd']);
    // "ab " = 3 codes × 0.5 em × 10pt = 15pt natural; target 30pt → 200%.
    expect(placed[0]).toMatchObject({ a: 1, b: 0, c: 0, d: 1, x: 10, y: 80, size: 10, scale: 200 });
    expect(placed[1]?.scale).toBe(200); // 2 codes → 10pt natural, 20pt box
  });

  it('derives angle, size and stretch from mapped points (sideways quad)', () => {
    const p = placeQuad({ text: 'abcd', p0: { x: 100, y: 100 }, p1: { x: 100, y: 140 }, top: { x: 90, y: 100 } })!;
    expect(p).toMatchObject({ a: 0, b: 1, c: -1, d: 0, size: 10 });
    expect(p.scale).toBeCloseTo(200); // 40pt over 4 × 5pt natural
    expect(placeQuad({ text: 'x', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, top: { x: 0, y: 5 } })).toBeNull();
  });

  it('undoes the OCR-time rotation (inverse of rotatePixel) for every quarter turn', () => {
    const g: PageGeometry = { x0: 0, y0: 0, width: 300, height: 200, rotation: 0 };
    for (const r of [0, 90, 180, 270] as QuarterTurn[]) {
      const map = renderPixelMapper(g, 2, 600, 400, r);
      for (const [x, y] of [[0, 0], [123, 45], [599, 399]]) {
        const q = rotatePixel(x, y, 600, 400, r);
        const p = map(q.x, q.y);
        expect(p.x).toBeCloseTo(x / 2, 9);
        expect(p.y).toBeCloseTo(200 - y / 2, 9);
      }
    }
  });

  it('round-trips words (incl. Hindi) through pdf.js on image-only pages at every rotation', async () => {
    const src = await PDFDocument.load(await rotatedPdf());
    const img = await src.embedPng(TINY_PNG);
    for (const page of src.getPages()) {
      const { width, height, x, y } = page.getCropBox();
      page.drawImage(img, { x, y, width, height }); // "scan": image only, no text
    }
    const scale = 300 / 72;
    // OCR result in rendered-pixel coordinates (as the tool gets it from Tesseract).
    const displayLines = [
      [{ text: 'Hello', x0: 20, y0: 20, x1: 60, y1: 34 }, { text: 'world', x0: 66, y0: 20, x1: 110, y1: 34 }],
      [{ text: 'नमस्ते', x0: 20, y0: 50, x1: 70, y1: 66 }, { text: 'दुनिया', x0: 76, y0: 50, x1: 126, y1: 66 }],
    ];
    const pixelLines: OcrLine[] = displayLines.map((ws) => ({
      bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
      words: ws.map((w) => ({ text: w.text, confidence: 90, bbox: { x0: w.x0 * scale, y0: w.y0 * scale, x1: w.x1 * scale, y1: w.y1 * scale } })),
    }));
    for (const page of src.getPages()) {
      // Same path as the tool: render-pixel boxes → (no OCR turn) → display → PDF.
      const g = pageGeometry(page);
      const dw = g.rotation % 180 ? g.height : g.width;
      const dh = g.rotation % 180 ? g.width : g.height;
      const quads = quadsFromOcrLines(pixelLines, renderPixelMapper(g, scale, dw * scale, dh * scale, 0));
      expect(addInvisibleTextLayer(src, page, quads)).toBe(4);
    }
    const bytes = await src.save();

    const out = await PDFDocument.load(bytes);
    const pdf = await open(bytes);
    for (let i = 1; i <= 4; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.filter((it) => 'str' in it && it.str !== '') as { str: string; transform: number[]; width: number }[];
      // pdf.js may merge words of one line into a single item; group items into lines by baseline.
      const placedItems = items.map((it) => {
        const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { str: it.str, vx, vy, width: it.width };
      });
      const byLine: (typeof placedItems)[] = [];
      for (const it of placedItems) {
        const line = byLine.find((l) => Math.abs(l[0].vy - it.vy) < 2 || (!it.str.trim() && l === byLine[byLine.length - 1]));
        if (line) line.push(it);
        else byLine.push([it]);
      }
      expect(byLine.map((l) => l.map((x) => x.str).join('').trim())).toEqual(['Hello world', 'नमस्ते दुनिया']); // reading order, Hindi identical
      byLine.forEach((l, li) => {
        const first = displayLines[li][0];
        const last = displayLines[li][displayLines[li].length - 1];
        expect(Math.abs(l[0].vx - first.x0)).toBeLessThan(2);
        expect(Math.abs(l[0].vy - first.y1)).toBeLessThan(2);
        // The line's text spans from the first word's start to the last word's end. (pdf.js
        // reports combining marks — Devanagari vowel signs — as zero-width in item widths,
        // so this holds for Latin; each Hindi word still starts at its box.)
        if (li === 0) {
          const end = l[l.length - 1].vx + l[l.length - 1].width;
          expect(Math.abs(end - last.x1)).toBeLessThan(2);
        } else {
          expect(Math.abs(l[l.length - 1].vx - last.x0)).toBeLessThan(2);
        }
      });
      // Original content kept: the page still draws its image.
      const res = out.getPage(i - 1).node.Resources()!;
      const xo = res.lookup(PDFName.of('XObject'), PDFDict);
      const imgs = xo.entries().filter(([, v]) => {
        const o = v instanceof PDFRef ? out.context.lookup(v) : v;
        return o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image';
      });
      expect(imgs.length).toBe(1);
    }
    await pdf.destroy();
  });
});

describe('searchable PDF from images', () => {
  it('one page per image, OCR text extractable and placed on the image', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    // Image 1000×500 px, OCR'd on a 2× upscaled copy (2000×1000).
    const ocrPage = {
      text: '',
      confidence: 90,
      width: 2000,
      height: 1000,
      lines: [{ bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, words: [{ text: 'Invoice', confidence: 95, bbox: { x0: 200, y0: 100, x1: 600, y1: 180 } }, { text: '२०२४', confidence: 80, bbox: { x0: 700, y0: 100, x1: 900, y1: 180 } }] }],
    };
    const { imagesToSearchablePdf, pointsPerPixel } = await import('./searchablePdf');
    const bytes = await imagesToSearchablePdf([{ image: { bytes: png, format: 'png', width: 1000, height: 500 }, ocr: ocrPage }]);
    const k = pointsPerPixel(1000, 500);
    expect(k).toBe(0.75);
    const pdf = await open(bytes);
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    expect(vp.width).toBeCloseTo(750);
    const items = (await page.getTextContent()).items.filter((i) => 'str' in i && i.str !== '') as { str: string; transform: number[] }[];
    expect(items.map((i) => i.str).join('').trim()).toBe('Invoice २०२४');
    const [x, y] = vp.convertToViewportPoint(items[0].transform[4], items[0].transform[5]);
    expect(x).toBeCloseTo(100 * 0.75, 0); // 200 px in the 2× copy = 100 px in the image
    expect(y).toBeCloseTo(90 * 0.75, 0);
    await pdf.destroy();
  });
});

/**
 * Regression: page orientation × content orientation. A fake Tesseract runs on the rendered
 * page turned by the tool's rotation: confident and wide boxes when the text reads left to
 * right, confident but tall boxes when it runs vertically (Tesseract still reads it), and
 * low confidence upside down — like the real engine.
 */
describe('text layer orientation (regression)', () => {
  const PAGE = { w: 595.28, h: 841.89 };
  const LINES = [
    { y: 745.9, words: [['This', 57.6, 100], ['page', 106, 141], ['is', 147, 158], ['rotated', 164, 220]] },
    { y: 693.1, words: [['Searchable', 57.6, 150], ['text', 156, 185]] },
  ] as const;
  const H = 17; // word height in points

  type Content = 'user-upright' | 'display-upright';

  /** Word rectangle in user space: baseline start, baseline direction u, up direction v. */
  function wordFrame(content: Content, rotation: number, x0: number, x1: number, y: number) {
    if (content === 'user-upright') return { p0: { x: x0, y }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, len: x1 - x0 };
    // Content drawn turned with the page (CCW by /Rotate) so it reads upright on screen:
    // place it by its display position instead.
    const t = (rotation * Math.PI) / 180;
    const u = { x: Math.round(Math.cos(t)), y: Math.round(Math.sin(t)) };
    const v = { x: -u.y, y: u.x };
    return { p0: { x: x0, y }, u, v, len: x1 - x0 };
  }

  async function run(rotation: QuarterTurn, content: Content) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.w, PAGE.h]);
    page.setRotation(degrees(rotation));
    const g = pageGeometry(page);
    // For display-upright content, express positions in display space so words stay on the page.
    // Display-upright content: baselines 96pt and 149pt below the displayed top edge.
    const toUser = (x: number, y: number, line: number) => (content === 'user-upright' ? { x, y } : displayToPdf(g, x, 96 + line * 53));
    const scale = 300 / 72;
    const dw = (g.rotation % 180 ? g.height : g.width) * scale;
    const dh = (g.rotation % 180 ? g.width : g.height) * scale;
    const words = LINES.map((l, li) =>
      l.words.map(([text, x0, x1]) => {
        const f = wordFrame(content, rotation, x0, x1, l.y);
        const p0 = toUser(x0, l.y, li);
        return { text, p0, u: f.u, v: f.v, len: f.len };
      }),
    );

    const fakeOcr = async (r: QuarterTurn): Promise<OcrPage> => {
      let dir = 'ltr' as 'ltr' | 'rtl' | 'vertical';
      const lines = words.map((ws) => {
        const out = ws.map((w) => {
          const corners = [
            w.p0,
            { x: w.p0.x + w.u.x * w.len, y: w.p0.y + w.u.y * w.len },
            { x: w.p0.x + w.v.x * H, y: w.p0.y + w.v.y * H },
            { x: w.p0.x + w.u.x * w.len + w.v.x * H, y: w.p0.y + w.u.y * w.len + w.v.y * H },
          ].map((p) => {
            const d = pdfToDisplay(g, p.x, p.y);
            return rotatePixel(d.x * scale, d.y * scale, dw, dh, r);
          });
          const base = { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y };
          dir = Math.abs(base.y) > Math.abs(base.x) ? 'vertical' : base.x > 0 ? 'ltr' : 'rtl';
          const xs = corners.map((c) => c.x);
          const ys = corners.map((c) => c.y);
          return { text: w.text, confidence: dir === 'rtl' ? 15 : 92, bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
        });
        return { words: out, bbox: out[0].bbox };
      });
      const conf = dir === 'rtl' ? 15 : 92;
      return { text: '', confidence: conf, lines, width: r % 180 ? dh : dw, height: r % 180 ? dw : dh };
    };

    const { result, rotation: turned } = await recognizeOriented((r) => fakeOcr(r), { auto: true });
    const quads = quadsFromOcrLines(result.lines, renderPixelMapper(g, scale, dw, dh, turned));
    addInvisibleTextLayer(doc, page, quads);
    const pdf = await open(await doc.save());
    const tc = await (await pdf.getPage(1)).getTextContent();
    await pdf.destroy();
    const items = tc.items.filter((i) => 'str' in i) as { str: string; transform: number[]; hasEOL: boolean }[];
    let text = '';
    for (const it of items) text += it.str + (it.hasEOL ? '\n' : '');
    return { items: items.filter((i) => i.str.trim()), text: text.replace(/ +\n/g, '\n').trim(), expected: words };
  }

  for (const rotation of [0, 90, 180, 270] as QuarterTurn[]) {
    for (const content of ['user-upright', 'display-upright'] as Content[]) {
      it(`/Rotate ${rotation}, content ${content}: words run along the content, ~17pt tall, two lines`, async () => {
        const { items, text, expected } = await run(rotation, content);
        expect(text.split('\n').map((l) => l.trim())).toEqual(['This page is rotated', 'Searchable text']);
        const u = expected[0][0].u;
        const v = expected[0][0].v;
        for (const it of items) {
          const [a, b, c, d] = it.transform;
          // Baseline direction ∥ content baseline, "up" ∥ content up, height ≈ 17 pt.
          expect(Math.abs(a * u.y - b * u.x)).toBeLessThan(1e-6);
          expect(a * u.x + b * u.y).toBeGreaterThan(0);
          expect(c * v.x + d * v.y).toBeCloseTo(H, 0);
          expect(Math.abs(c * v.y - d * v.x)).toBeLessThan(1e-6);
        }
        if (content === 'user-upright') {
          // The reported case: horizontal matrices (b≈0, c≈0, a and d > 0).
          for (const it of items) {
            expect(Math.abs(it.transform[1])).toBeLessThan(1e-6);
            expect(Math.abs(it.transform[2])).toBeLessThan(1e-6);
            expect(it.transform[0]).toBeGreaterThan(0);
            expect(it.transform[3]).toBeCloseTo(17, 0);
          }
        }
      });
    }
  }

  it('orientation helpers: vertical boxes and low confidence trigger a check', () => {
    const page = (conf: number, w: number, h: number): OcrPage => ({ text: '', confidence: conf, width: 100, height: 100, lines: [{ bbox: { x0: 0, y0: 0, x1: w, y1: h }, words: [{ text: 'word', confidence: conf, bbox: { x0: 0, y0: 0, x1: w, y1: h } }, { text: 'more', confidence: conf, bbox: { x0: 0, y0: 0, x1: w, y1: h } }] }] });
    expect(needsOrientationCheck(page(92, 60, 15))).toBe(false);
    expect(needsOrientationCheck(page(92, 15, 60))).toBe(true);
    expect(needsOrientationCheck(page(30, 60, 15))).toBe(true);
    expect(wideFraction(page(92, 15, 60))).toBe(0);
    expect(orientationScore(page(92, 60, 15))).toBeGreaterThan(orientationScore(page(92, 15, 60)));
  });
});
