/**
 * Image decode → transform → encode. Runs both inside the worker (OffscreenCanvas)
 * and on the main thread (HTMLCanvasElement) as a fallback.
 */
import { computeResize, clampToPixels, rotatedSize, type ResizeMode, type Rotation } from '../resize';

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

export const FORMAT_LABEL: Record<OutputFormat, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
};

export const FORMAT_EXT: Record<OutputFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export interface ImageJobOptions {
  format: OutputFormat;
  /** 0–1, ignored for PNG. */
  quality: number;
  resize: ResizeMode;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  /** Fill colour behind transparent pixels (always used for JPEG). */
  background: string;
}

export interface ImageJobResult {
  blob: Blob;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  /** True if the output was scaled down further to fit the browser's canvas limit. */
  clamped: boolean;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Drawable = ImageBitmap | HTMLImageElement;

export class UnsupportedOutputError extends Error {}

/** Decode with EXIF orientation applied. Falls back if the option isn't supported. */
export async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    if (e instanceof TypeError) return createImageBitmap(blob); // option unsupported; modern browsers orient by default
    throw e;
  }
}

export function sizeOf(img: Drawable): { width: number; height: number } {
  return 'naturalWidth' in img ? { width: img.naturalWidth, height: img.naturalHeight } : { width: img.width, height: img.height };
}

export function drawTransformed(img: Drawable, opts: ImageJobOptions, makeCanvas: (w: number, h: number) => AnyCanvas) {
  const src = sizeOf(img);
  const target = computeResize(src.width, src.height, opts.resize);
  const rotated = rotatedSize(target.width, target.height, opts.rotate);
  const clamp = clampToPixels(rotated.width, rotated.height);
  const canvas = makeCanvas(clamp.width, clamp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D isn’t available.');
  const opaque = opts.format === 'image/jpeg';
  if (opaque || opts.background !== 'transparent') {
    ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((opts.rotate * Math.PI) / 180);
  ctx.scale((opts.flipH ? -1 : 1) * clamp.factor, (opts.flipV ? -1 : 1) * clamp.factor);
  ctx.drawImage(img, -target.width / 2, -target.height / 2, target.width, target.height);
  return { canvas, srcWidth: src.width, srcHeight: src.height, clamped: clamp.factor < 1 };
}

export async function encodeCanvas(canvas: AnyCanvas, format: OutputFormat, quality: number): Promise<Blob> {
  const q = format === 'image/png' ? undefined : quality;
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: format, quality: q })
      : await new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, format, q));
  if (!blob) throw new Error('The browser couldn’t encode the image (it may be too large).');
  // Browsers silently fall back to PNG for formats they can't encode.
  if (blob.type !== format) throw new UnsupportedOutputError(`This browser can’t save ${FORMAT_LABEL[format]} images. Pick another output format.`);
  return blob;
}

export async function processDrawable(img: Drawable, opts: ImageJobOptions, makeCanvas: (w: number, h: number) => AnyCanvas): Promise<ImageJobResult> {
  const { canvas, srcWidth, srcHeight, clamped } = drawTransformed(img, opts, makeCanvas);
  try {
    const blob = await encodeCanvas(canvas, opts.format, opts.quality);
    return { blob, width: canvas.width, height: canvas.height, srcWidth, srcHeight, clamped };
  } finally {
    canvas.width = canvas.height = 0; // release memory early
  }
}
