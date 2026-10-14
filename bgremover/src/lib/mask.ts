import type { Rect } from './preprocess';

/**
 * Mask maths. Three layers make up the final alpha of each pixel:
 *   raw    — the model's mask, 0–255 (never changed after inference)
 *   refine — a threshold/softness curve applied to raw through a 256-entry lookup table
 *   edits  — the erase/restore brush layer, signed: −127 = fully erased, +127 = fully restored, 0 = untouched
 * The original image pixels are never modified, so restoring always brings back the real pixels.
 */

export interface Refine {
  /** 0–1: where the curve crosses 50 %. 0.5 leaves the model's mask as it is. */
  threshold: number;
  /** 0–1: width of the transition. 1 = the model's own soft edge, 0 = a hard cut-out. */
  softness: number;
}

export const DEFAULT_REFINE: Refine = { threshold: 0.5, softness: 1 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Lookup table for the refine curve: a linear ramp from (threshold − w/2) to (threshold + w/2), where
 * w = softness. With the defaults this is the identity; with softness 0 it is a hard step at the threshold.
 */
export function refineLut({ threshold, softness }: Refine): Uint8Array {
  const lut = new Uint8Array(256);
  const t = clamp01(threshold);
  const w = clamp01(softness);
  const lo = t - w / 2;
  const hi = t + w / 2;
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let out: number;
    if (hi - lo < 1e-6) out = v >= t ? 1 : 0;
    else out = clamp01((v - lo) / (hi - lo));
    lut[i] = Math.round(out * 255);
  }
  return lut;
}

/** Applies one brush-layer value to a refined alpha. */
export function applyEdit(alpha: number, edit: number): number {
  if (edit === 0) return alpha;
  if (edit > 0) return Math.round(alpha + ((255 - alpha) * edit) / 127);
  return Math.round((alpha * (127 + edit)) / 127);
}

/** Final alpha for every pixel of `rect` (default: whole image), written into `out` (row stride = width). */
export function computeAlpha(raw: Uint8Array, edits: Int8Array | null, lut: Uint8Array, width: number, out: Uint8Array | Uint8ClampedArray, rect?: Rect, outStride = 1, outOffset = 0): void {
  const height = raw.length / width;
  const r = rect ?? { x: 0, y: 0, w: width, h: height };
  for (let y = r.y; y < r.y + r.h; y++) {
    let i = y * width + r.x;
    const end = i + r.w;
    for (; i < end; i++) {
      const a = lut[raw[i]];
      out[i * outStride + outOffset] = edits && edits[i] !== 0 ? applyEdit(a, edits[i]) : a;
    }
  }
}

// ---------- Brush ----------

/** Brush coverage at distance `d` from the centre for radius `r`: solid core, linear fall-off over the outer 30 %. */
export function brushCoverage(d: number, r: number): number {
  if (d >= r) return 0;
  const core = r * 0.7;
  if (d <= core) return 1;
  return (r - d) / (r - core);
}

export const intersectRect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
};

export const unionRect = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * One brush stroke on the edit layer. Coverage accumulates as the max over all dabs of the stroke, and
 * each pixel is set to lerp(valueBeforeStroke, target, coverage). So going over the same spot twice in
 * one stroke doesn't build up, and soft edges stay soft.
 */
export class Stroke {
  readonly target: number;
  readonly before: Int8Array;
  /** Coverage per pixel (0–255) for this stroke; only `dirty` is non-zero. */
  private readonly coverage: Uint8Array;
  dirty: Rect | null = null;
  private last: { x: number; y: number } | null = null;

  constructor(
    private readonly edits: Int8Array,
    private readonly width: number,
    private readonly height: number,
    mode: 'erase' | 'restore',
    scratch?: Uint8Array,
  ) {
    this.target = mode === 'erase' ? -127 : 127;
    this.before = edits.slice();
    this.coverage = scratch && scratch.length === edits.length ? scratch : new Uint8Array(edits.length);
  }

  /** Paints a line from the previous point to (x, y) in image pixels. Returns the rect that changed. */
  to(x: number, y: number, radius: number): Rect | null {
    const r = Math.max(0.5, radius);
    const from = this.last;
    this.last = { x, y };
    if (!from) return this.dab(x, y, r);
    const dist = Math.hypot(x - from.x, y - from.y);
    const n = Math.max(1, Math.ceil(dist / Math.max(0.5, r / 4)));
    let changed: Rect | null = null;
    for (let k = 1; k <= n; k++) {
      changed = unionRect(changed, this.dab(from.x + ((x - from.x) * k) / n, from.y + ((y - from.y) * k) / n, r));
    }
    return changed;
  }

  private dab(cx: number, cy: number, r: number): Rect | null {
    const box = intersectRect(
      { x: Math.floor(cx - r), y: Math.floor(cy - r), w: Math.ceil(2 * r) + 2, h: Math.ceil(2 * r) + 2 },
      { x: 0, y: 0, w: this.width, h: this.height },
    );
    if (!box) return null;
    const { edits, before, coverage, target, width } = this;
    for (let y = box.y; y < box.y + box.h; y++) {
      const dy = y + 0.5 - cy;
      for (let x = box.x; x < box.x + box.w; x++) {
        const c = Math.round(brushCoverage(Math.hypot(x + 0.5 - cx, dy), r) * 255);
        const i = y * width + x;
        if (c <= coverage[i]) continue;
        coverage[i] = c;
        const b = before[i];
        edits[i] = Math.round(b + ((target - b) * c) / 255);
      }
    }
    this.dirty = unionRect(this.dirty, box);
    return box;
  }

  /** Ends the stroke: clears the coverage scratch and returns the undo record (or null if nothing changed). */
  finish(): EditPatch | null {
    const rect = this.dirty;
    if (!rect) return null;
    const { width } = this;
    const before = new Int8Array(rect.w * rect.h);
    const after = new Int8Array(rect.w * rect.h);
    for (let y = 0; y < rect.h; y++) {
      const s = (rect.y + y) * width + rect.x;
      before.set(this.before.subarray(s, s + rect.w), y * rect.w);
      after.set(this.edits.subarray(s, s + rect.w), y * rect.w);
      this.coverage.fill(0, s, s + rect.w);
    }
    return { rect, before, after };
  }
}

/** A rectangular change to the edit layer, enough to undo or redo it. */
export interface EditPatch {
  rect: Rect;
  before: Int8Array;
  after: Int8Array;
}

export function applyPatch(edits: Int8Array, width: number, patch: EditPatch, direction: 'undo' | 'redo'): void {
  const src = direction === 'undo' ? patch.before : patch.after;
  const { rect } = patch;
  for (let y = 0; y < rect.h; y++) {
    edits.set(src.subarray(y * rect.w, (y + 1) * rect.w), (rect.y + y) * width + rect.x);
  }
}

/** Patch that resets the whole edit layer to 0 (for "Reset brush edits", undoable). */
export function resetPatch(edits: Int8Array, width: number, height: number): EditPatch | null {
  if (!edits.some((v) => v !== 0)) return null;
  return { rect: { x: 0, y: 0, w: width, h: height }, before: edits.slice(), after: new Int8Array(edits.length) };
}

// ---------- Crop to subject ----------

/** Bounding box of pixels with alpha ≥ minAlpha, or null if there are none. */
export function subjectBounds(alpha: Uint8Array | Uint8ClampedArray, width: number, height: number, minAlpha = 16, stride = 1, offset = 0): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    let rowHas = false;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[(row + x) * stride + offset] >= minAlpha) {
        rowHas = true;
        if (x < x0) x0 = x;
        // Scan from the right for this row's last hit, then stop.
        let xr = width - 1;
        while (xr > x1 && alpha[(row + xr) * stride + offset] < minAlpha) xr--;
        if (xr > x1) x1 = xr;
        break;
      }
    }
    if (rowHas) {
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Output rectangle for "crop to subject": the subject bounds grown by `paddingPct` of the subject's
 * larger side. When `clampToImage` is true the result stays inside the image; otherwise it may extend
 * beyond it (the background fills the extra space).
 */
export function cropRect(bounds: Rect | null, paddingPct: number, imgW: number, imgH: number, clampToImage: boolean): Rect {
  if (!bounds) return { x: 0, y: 0, w: imgW, h: imgH };
  const pad = Math.round((Math.max(bounds.w, bounds.h) * Math.max(0, paddingPct)) / 100);
  let r = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad };
  if (clampToImage) r = intersectRect(r, { x: 0, y: 0, w: imgW, h: imgH }) ?? { x: 0, y: 0, w: imgW, h: imgH };
  return r;
}

/** Share of pixels that are mostly opaque / mostly transparent; used to sanity-check results. */
export function maskStats(alpha: Uint8Array): { opaque: number; transparent: number } {
  let o = 0;
  let t = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] >= 200) o++;
    else if (alpha[i] <= 55) t++;
  }
  return { opaque: o / alpha.length, transparent: t / alpha.length };
}
