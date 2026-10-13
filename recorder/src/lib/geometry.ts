/**
 * Resolution-independent geometry for the webcam bubble and output sizing.
 *
 * Bubble position is stored as the top-left corner as a FRACTION of the output frame
 * (0..1 on each axis), so the same layout works for the preview (any CSS size) and the
 * recording (any pixel size). Bubble size is a fraction of the output's shorter side.
 */

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type BubbleShape = 'circle' | 'rounded';
export type BubbleSize = 's' | 'm' | 'l';

export interface BubbleLayout {
  shape: BubbleShape;
  size: BubbleSize;
  /** Top-left, as a fraction of output width / height. */
  x: number;
  y: number;
  mirror: boolean;
  border: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bubble height as a fraction of the output's shorter side. */
export const SIZE_FRACTION: Record<BubbleSize, number> = { s: 0.2, m: 0.28, l: 0.38 };
/** Rounded rectangles are 4:3 landscape; circles are 1:1. */
export const ASPECT: Record<BubbleShape, number> = { circle: 1, rounded: 4 / 3 };
/** Gap between the bubble and the frame edge, as a fraction of the shorter side. */
export const MARGIN_FRACTION = 0.035;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bubble size as fractions of the output width and height. */
export function bubbleFraction(shape: BubbleShape, size: BubbleSize, outW: number, outH: number): { fw: number; fh: number } {
  const short = Math.min(outW, outH);
  const hPx = SIZE_FRACTION[size] * short;
  const wPx = hPx * ASPECT[shape];
  return { fw: Math.min(1, wPx / outW), fh: Math.min(1, hPx / outH) };
}

/** Keeps the bubble fully inside the frame. */
export function clampPosition(x: number, y: number, fw: number, fh: number): { x: number; y: number } {
  return { x: clamp(x, 0, Math.max(0, 1 - fw)), y: clamp(y, 0, Math.max(0, 1 - fh)) };
}

/** Top-left fractions that put the bubble in a corner, with the standard margin. */
export function cornerPosition(corner: Corner, shape: BubbleShape, size: BubbleSize, outW: number, outH: number): { x: number; y: number } {
  const { fw, fh } = bubbleFraction(shape, size, outW, outH);
  const short = Math.min(outW, outH);
  const mx = (MARGIN_FRACTION * short) / outW;
  const my = (MARGIN_FRACTION * short) / outH;
  const x = corner === 'tl' || corner === 'bl' ? mx : 1 - fw - mx;
  const y = corner === 'tl' || corner === 'tr' ? my : 1 - fh - my;
  return clampPosition(x, y, fw, fh);
}

/** Which corner a position is closest to (for highlighting the corner buttons). */
export function nearestCorner(x: number, y: number, fw: number, fh: number): Corner {
  const cx = x + fw / 2;
  const cy = y + fh / 2;
  return (cy < 0.5 ? 't' : 'b') + (cx < 0.5 ? 'l' : 'r') as Corner;
}

/**
 * New position after dragging by (dx, dy) CSS pixels inside a preview of size viewW × viewH
 * that shows the whole output frame. Clamped so the bubble stays inside.
 */
export function dragPosition(
  start: { x: number; y: number },
  dx: number,
  dy: number,
  viewW: number,
  viewH: number,
  fw: number,
  fh: number,
): { x: number; y: number } {
  if (viewW <= 0 || viewH <= 0) return clampPosition(start.x, start.y, fw, fh);
  return clampPosition(start.x + dx / viewW, start.y + dy / viewH, fw, fh);
}

/** The bubble rectangle in output pixels (integers), plus corner radius and border width. */
export function bubbleRect(layout: BubbleLayout, outW: number, outH: number): Rect & { radius: number; borderWidth: number } {
  const { fw, fh } = bubbleFraction(layout.shape, layout.size, outW, outH);
  const pos = clampPosition(layout.x, layout.y, fw, fh);
  const w = Math.round(fw * outW);
  const h = Math.round(fh * outH);
  const x = Math.round(pos.x * outW);
  const y = Math.round(pos.y * outH);
  const radius = layout.shape === 'circle' ? Math.min(w, h) / 2 : Math.round(Math.min(w, h) * 0.14);
  const borderWidth = layout.border ? Math.max(2, Math.round(Math.min(w, h) * 0.025)) : 0;
  return { x, y, w, h, radius, borderWidth };
}

/** Fit src inside dst keeping aspect ratio (letterbox). */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const s = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * s);
  const h = Math.round(srcH * s);
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h };
}

/** Source crop that covers a dst-shaped box (centre crop), for drawImage(src, sx, sy, sw, sh, ...). */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): { sx: number; sy: number; sw: number; sh: number } {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  const dstAspect = dstW / dstH;
  const srcAspect = srcW / srcH;
  if (srcAspect > dstAspect) {
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

export type ResolutionCap = '720' | '1080' | 'source';

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Output size from the source size and a cap. "720p" means the frame fits inside 1280×720
 * (or 720×1280 for portrait sources); never upscales; keeps aspect; even dimensions
 * (H.264 / VP9 encoders need them).
 */
export function outputSize(srcW: number, srcH: number, cap: ResolutionCap): { width: number; height: number } {
  if (!(srcW > 0) || !(srcH > 0)) return { width: 1280, height: 720 };
  if (cap === 'source') return { width: even(srcW), height: even(srcH) };
  const short = cap === '720' ? 720 : 1080;
  const long = Math.round((short * 16) / 9);
  const landscape = srcW >= srcH;
  const boxW = landscape ? long : short;
  const boxH = landscape ? short : long;
  const s = Math.min(1, boxW / srcW, boxH / srcH);
  return { width: even(srcW * s), height: even(srcH * s) };
}
