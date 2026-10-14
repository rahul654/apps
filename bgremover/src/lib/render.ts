/**
 * Browser-side image work on the main thread: decoding for display, building the cut-out, and
 * composing exports. The maths it relies on lives in mask.ts and is unit-tested there.
 */
import { FORMAT_INFO, type ExportFormat } from './format';
import { computeAlpha, cropRect, refineLut, subjectBounds, type Refine } from './mask';
import type { Prefs } from './prefs';
import type { Rect } from './preprocess';

export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This browser can’t decode this image.');
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The image's pixels, plus its own alpha channel if it has any transparency (else null). */
export function readPixels(bitmap: ImageBitmap): { data: ImageData; srcAlpha: Uint8Array | null } {
  const c = makeCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  let srcAlpha: Uint8Array | null = null;
  const px = data.data;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] !== 255) {
      srcAlpha = new Uint8Array(px.length / 4);
      for (let j = 0; j < srcAlpha.length; j++) srcAlpha[j] = px[j * 4 + 3];
      break;
    }
  }
  return { data, srcAlpha };
}

/** Writes the final alpha of `rect` into the cut-out's alpha channel (RGB is untouched). */
export function writeCutoutAlpha(cutout: ImageData, raw: Uint8Array, edits: Int8Array | null, lut: Uint8Array, srcAlpha: Uint8Array | null, rect?: Rect) {
  const w = cutout.width;
  computeAlpha(raw, edits, lut, w, cutout.data, rect, 4, 3);
  if (!srcAlpha) return;
  const r = rect ?? { x: 0, y: 0, w, h: cutout.height };
  const px = cutout.data;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let i = y * w + r.x, end = i + r.w; i < end; i++) px[i * 4 + 3] = (px[i * 4 + 3] * srcAlpha[i] + 127) / 255;
  }
}

let filterSupport: boolean | null = null;
function canvasFilterWorks(): boolean {
  if (filterSupport === null) {
    const ctx = makeCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D & { filter?: string };
    filterSupport = typeof ctx.filter === 'string' && ((ctx.filter = 'blur(2px)'), ctx.filter === 'blur(2px)');
  }
  return filterSupport;
}

/** A blurred copy of the image. Overscans slightly so the edges don't fade to transparent. */
export function blurredImage(src: CanvasImageSource, w: number, h: number, radiusPx: number): HTMLCanvasElement {
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d')!;
  const r = Math.max(1, radiusPx);
  if (canvasFilterWorks()) {
    ctx.filter = `blur(${r}px)`;
    ctx.drawImage(src, -2 * r, -2 * r, w + 4 * r, h + 4 * r);
    ctx.filter = 'none';
    return out;
  }
  // Fallback (Safari without canvas filters): shrink, then scale back up with smoothing.
  const scale = Math.min(1, 1.5 / r);
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const small = makeCanvas(sw, sh);
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, sw, sh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  return out;
}

/** Draws `img` to cover a w×h area (like CSS object-fit: cover). */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export interface ShadowStyle {
  color: string;
  blur: number;
  offsetY: number;
}

/** Shadow in image pixels for an image whose longer side is `longSide`. */
export function shadowFor(prefs: Prefs, longSide: number): ShadowStyle | null {
  if (!prefs.shadow || prefs.shadowOpacity <= 0) return null;
  return {
    color: `rgba(0, 0, 0, ${prefs.shadowOpacity})`,
    blur: (prefs.shadowBlur / 100) * longSide,
    offsetY: (prefs.shadowOffset / 100) * longSide,
  };
}

export const blurRadius = (prefs: Prefs, longSide: number) => Math.max(1, (prefs.blur / 100) * longSide);

export interface ExportInput {
  bitmap: ImageBitmap;
  raw: Uint8Array;
  edits: Int8Array | null;
  refine: Refine;
  prefs: Prefs;
  bgImage: ImageBitmap | null;
}

/** Builds the cut-out canvas and computes where the output frame sits (whole image or cropped). */
function prepare({ bitmap, raw, edits, refine, prefs }: ExportInput) {
  const w = bitmap.width;
  const h = bitmap.height;
  const { data, srcAlpha } = readPixels(bitmap);
  writeCutoutAlpha(data, raw, edits, refineLut(refine), srcAlpha);
  const cut = makeCanvas(w, h);
  cut.getContext('2d')!.putImageData(data, 0, 0);
  let frame: Rect = { x: 0, y: 0, w, h };
  if (prefs.crop) {
    const bounds = subjectBounds(data.data, w, h, 16, 4, 3);
    // A blurred-photo background only exists inside the image, so the crop can't extend past it.
    frame = cropRect(bounds, prefs.padding, w, h, prefs.background === 'blur');
  }
  return { cut, frame, w, h };
}

/** Composes the final image (background, shadow, subject, crop) at original resolution. */
export function composeExport(input: ExportInput, format: ExportFormat): HTMLCanvasElement {
  const { prefs, bitmap, bgImage } = input;
  const { cut, frame, w, h } = prepare(input);
  const out = makeCanvas(frame.w, frame.h);
  const ctx = out.getContext('2d')!;
  const longSide = Math.max(w, h);
  if (prefs.background === 'color' || (!FORMAT_INFO[format].alpha && prefs.background === 'transparent')) {
    ctx.fillStyle = prefs.background === 'color' ? prefs.color : '#ffffff';
    ctx.fillRect(0, 0, frame.w, frame.h);
  } else if (prefs.background === 'blur') {
    ctx.drawImage(blurredImage(bitmap, w, h, blurRadius(prefs, longSide)), -frame.x, -frame.y);
  } else if (prefs.background === 'image' && bgImage) {
    drawCover(ctx, bgImage, frame.w, frame.h);
  } else if (!FORMAT_INFO[format].alpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, frame.w, frame.h);
  }
  const shadow = shadowFor(prefs, longSide);
  if (shadow) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.drawImage(cut, -frame.x, -frame.y);
    ctx.restore();
  } else {
    ctx.drawImage(cut, -frame.x, -frame.y);
  }
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  const { mime } = FORMAT_INFO[format];
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser couldn’t encode the image (it may be too large).'))), mime, format === 'png' ? undefined : quality);
  });
}

let webpSupport: Promise<boolean> | null = null;
/** Safari can decode WebP but can't encode it from a canvas (it silently returns PNG). */
export function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= new Promise((resolve) => {
    try {
      makeCanvas(2, 2).toBlob((b) => resolve(b?.type === 'image/webp'), 'image/webp');
    } catch {
      resolve(false);
    }
  });
  return webpSupport;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
