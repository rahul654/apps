export type ResizeMode =
  | { kind: 'none' }
  | { kind: 'fit'; maxWidth?: number; maxHeight?: number; enlarge?: boolean }
  | { kind: 'percent'; percent: number };

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Output dimensions for a resize, always keeping aspect ratio and returning whole
 * pixels ≥ 1. `fit` only shrinks unless `enlarge` is set. Width/height are of the
 * source *after* EXIF orientation is applied.
 */
export function computeResize(width: number, height: number, mode: ResizeMode): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error('Image has no size.');
  let scale = 1;
  if (mode.kind === 'percent') {
    if (!(mode.percent > 0)) throw new Error('Percentage must be greater than 0.');
    scale = mode.percent / 100;
  } else if (mode.kind === 'fit') {
    const sx = mode.maxWidth && mode.maxWidth > 0 ? mode.maxWidth / width : Infinity;
    const sy = mode.maxHeight && mode.maxHeight > 0 ? mode.maxHeight / height : Infinity;
    scale = Math.min(sx, sy);
    if (!Number.isFinite(scale)) scale = 1; // no limits given
    if (!mode.enlarge) scale = Math.min(scale, 1);
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Canvas size after rotating a w×h image. */
export function rotatedSize(width: number, height: number, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/** Largest canvas we'll allocate (iOS Safari limit is ~16.7 MP). */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** Scale down (w, h) so w*h ≤ maxPixels. Returns the factor applied (≤ 1). */
export function clampToPixels(width: number, height: number, maxPixels = MAX_CANVAS_PIXELS): { width: number; height: number; factor: number } {
  const px = width * height;
  if (px <= maxPixels) return { width, height, factor: 1 };
  const factor = Math.sqrt(maxPixels / px);
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), factor };
}

/** Fit (iw, ih) inside a (bw, bh) box keeping aspect ratio (contain). */
export function containIn(iw: number, ih: number, bw: number, bh: number): { width: number; height: number; scale: number } {
  const scale = Math.min(bw / iw, bh / ih);
  return { width: iw * scale, height: ih * scale, scale };
}
