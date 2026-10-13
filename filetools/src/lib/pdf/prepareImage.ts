/** Turn any browser-decodable image into PNG/JPEG bytes pdf-lib can embed (browser only). */
import { decodeOnMain } from '../image/runner';
import { sizeOf } from '../image/process';
import { clampToPixels } from '../resize';
import { readJpegOrientation, sniffType } from '../sniff';
import type { EmbeddableImage } from './ops';

function pngSize(b: Uint8Array): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) return null;
    const marker = b[off + 1];
    const len = v.getUint16(off + 2);
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: v.getUint16(off + 5), width: v.getUint16(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

/**
 * - JPEG without EXIF rotation and PNG are embedded as-is (no quality loss).
 * - Rotated JPEGs, WebP, GIF, BMP, AVIF, HEIC (where the browser decodes it) are
 *   redrawn: PNG if they have transparency, otherwise JPEG at quality 0.92.
 */
export async function prepareImageForPdf(file: Blob): Promise<EmbeddableImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffType(bytes);
  if (kind === 'png') {
    const s = pngSize(bytes);
    return { bytes, format: 'png', ...s };
  }
  if (kind === 'jpeg') {
    const o = readJpegOrientation(bytes);
    const s = jpegSize(bytes);
    if ((o === null || o === 1) && s) return { bytes, format: 'jpg', ...s };
  }
  const img = await decodeOnMain(file);
  try {
    const src = sizeOf(img);
    const c = clampToPixels(src.width, src.height);
    const canvas = document.createElement('canvas');
    canvas.width = c.width;
    canvas.height = c.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let hasAlpha = false;
    if (kind !== 'jpeg' && kind !== 'heic') {
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { hasAlpha = true; break; }
    }
    const type = hasAlpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.92));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Couldn’t convert the image.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: hasAlpha ? 'png' : 'jpg', width: c.width, height: c.height };
  } finally {
    if ('close' in img) img.close();
  }
}

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i.test(f.name);
}

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

export async function readBytes(f: Blob): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}
