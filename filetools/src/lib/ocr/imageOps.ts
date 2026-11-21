/** Canvas helpers for OCR input (browser only). */
import { decodeOnMain } from '../image/runner';
import { sizeOf } from '../image/process';
import { clampToPixels } from '../resize';
import { preprocessPixels, type PreprocessOptions } from './preprocess';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Decode a file (EXIF orientation applied) onto a white-backed canvas, within the pixel budget. */
export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const img = await decodeOnMain(file);
  try {
    const s = sizeOf(img);
    const c = clampToPixels(s.width, s.height);
    const canvas = makeCanvas(c.width, c.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if ('close' in img) img.close();
  }
}

export function rotateCanvas(src: HTMLCanvasElement, rotation: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (rotation === 0) return src;
  const swap = rotation === 90 || rotation === 270;
  const out = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

export function scaleCanvas(src: HTMLCanvasElement, factor: number, grayscaleOnly = false): HTMLCanvasElement {
  if (factor === 1) return src;
  const out = makeCanvas(src.width * factor, src.height * factor);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (grayscaleOnly) ctx.filter = 'grayscale(1)';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export function preprocessCanvas(src: HTMLCanvasElement, opts: PreprocessOptions): { canvas: HTMLCanvasElement; threshold?: number } {
  if (!opts.grayscale && !opts.contrast && !opts.binarize) return { canvas: src };
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, src.width, src.height);
  const res = preprocessPixels({ data: data.data, width: data.width, height: data.height }, opts);
  const out = makeCanvas(src.width, src.height);
  out.getContext('2d')!.putImageData(new ImageData(res.image.data as Uint8ClampedArray<ArrayBuffer>, res.image.width, res.image.height), 0, 0);
  return { canvas: out, threshold: res.threshold };
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t encode the image (out of memory?).'))), type, quality));
}

/** Downscale so the longer side is at most `max` px (for quick trial passes). */
export function fitCanvas(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const f = Math.min(1, max / Math.max(src.width, src.height));
  return f < 1 ? scaleCanvas(src, f) : src;
}

export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (c) c.width = c.height = 0;
}
