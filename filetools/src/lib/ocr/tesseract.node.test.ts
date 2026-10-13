/**
 * Real OCR in Node: render known text with @napi-rs/canvas (optional dependency of
 * pdfjs-dist), recognise it with tesseract.js and the bundled tessdata_fast files.
 */
import { fileURLToPath } from 'node:url';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromTesseract, similarity } from './result';

type NapiCanvas = {
  createCanvas(w: number, h: number): { getContext(t: '2d'): CanvasRenderingContext2D; encode(f: 'png'): Promise<Buffer> };
  GlobalFonts: { families: { family: string }[] };
};

let napi: NapiCanvas | null = null;
let worker: Worker | null = null;
const tessdata = fileURLToPath(new URL('../../assets/ocr/tessdata_fast', import.meta.url));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

beforeAll(async () => {
  try {
    napi = (await import('@napi-rs/canvas' as string)) as NapiCanvas;
  } catch {
    napi = null;
  }
  // Local langPath + gzip: reads <dir>/<lang>.traineddata.gz; cacheMethod 'none' writes nothing.
  worker = await createWorker('eng+hin', OEM.LSTM_ONLY, { langPath: tessdata, gzip: true, cacheMethod: 'none' });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
}, 120_000);

afterAll(async () => {
  await worker?.terminate();
});

async function render(lines: string[], font: string): Promise<Buffer> {
  const canvas = napi!.createCanvas(1400, 90 * lines.length + 60);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1400, 90 * lines.length + 60);
  ctx.fillStyle = '#000000';
  ctx.font = font;
  lines.forEach((l, i) => ctx.fillText(l, 30, 80 + i * 90));
  return canvas.encode('png');
}

describe('tesseract.js with the bundled language data', () => {
  it('recognises an English paragraph', async () => {
    if (!napi) return; // no canvas in this environment
    const truth = ['The quick brown fox jumps over the lazy dog.', 'Files never leave your device: 12345'];
    const png = await render(truth, '44px sans-serif');
    const { data } = await worker!.recognize(png, {}, { text: true, blocks: true });
    const page = fromTesseract(data as never, 1400, 240);
    const sim = similarity(norm(page.text), norm(truth.join(' ')));
    console.info(`[ocr] English similarity ${sim.toFixed(3)}, confidence ${page.confidence}: ${JSON.stringify(page.text.trim())}`);
    expect(sim).toBeGreaterThan(0.9);
    expect(page.lines.length).toBe(2);
    expect(page.lines[0].words[0].text).toMatch(/^the$/i);
    // Word boxes are in image pixels and ordered left to right.
    const xs = page.lines[0].words.map((w) => w.bbox.x0);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(page.lines[0].words[0].bbox.x0).toBeGreaterThan(20);
    expect(page.lines[0].words[0].bbox.x0).toBeLessThan(45);
  }, 120_000);

  it('recognises a Hindi sentence (if a Devanagari font is installed)', async (ctx) => {
    if (!napi) return;
    const family = napi.GlobalFonts.families.map((f) => f.family).find((f) => /devanagari|lohit|mangal|kokila|gargi|sarai/i.test(f));
    if (!family) {
      ctx.skip();
      return;
    }
    const truth = 'भारत एक विशाल देश है';
    const png = await render([truth], `52px "${family}"`);
    const { data } = await worker!.recognize(png, {}, { text: true, blocks: true });
    const text = fromTesseract(data as never, 1400, 150).text;
    const sim = similarity(norm(text).normalize('NFC'), norm(truth));
    console.info(`[ocr] Hindi (${family}) similarity ${sim.toFixed(3)}: ${JSON.stringify(text.trim())}`);
    expect(sim).toBeGreaterThan(0.8);
  }, 120_000);
});
