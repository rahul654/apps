import type { InputPlanSpec, OutputKind } from './models';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Model input size and where the image sits inside it (the rest is padding when letterboxed). */
export interface InputPlan {
  width: number;
  height: number;
  content: Rect;
}

const roundTo = (v: number, m: number) => Math.max(m, Math.round(v / m) * m);

export function planInput(srcW: number, srcH: number, spec: InputPlanSpec): InputPlan {
  if (srcW <= 0 || srcH <= 0) throw new Error('Image has no pixels');
  if (spec.mode === 'fixed') {
    const { width, height } = spec;
    if (spec.fit === 'stretch') return { width, height, content: { x: 0, y: 0, w: width, h: height } };
    const s = Math.min(width / srcW, height / srcH);
    const w = Math.max(1, Math.round(srcW * s));
    const h = Math.max(1, Math.round(srcH * s));
    return { width, height, content: { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h } };
  }
  let s = spec.short / Math.min(srcW, srcH);
  if (Math.max(srcW, srcH) * s > spec.maxLong) s = spec.maxLong / Math.max(srcW, srcH);
  const width = Math.min(roundTo(srcW * s, spec.multiple), Math.floor(spec.maxLong / spec.multiple) * spec.multiple);
  const height = Math.min(roundTo(srcH * s, spec.multiple), Math.floor(spec.maxLong / spec.multiple) * spec.multiple);
  return { width, height, content: { x: 0, y: 0, w: width, h: height } };
}

/**
 * RGBA pixels (row-major, width×height) → normalised float32 CHW tensor data.
 * Padding pixels outside `content` are filled with the mean (i.e. 0 after normalising).
 */
export function rgbaToTensor(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, mean: readonly number[], std: readonly number[], content?: Rect): Float32Array {
  const n = width * height;
  const out = new Float32Array(3 * n);
  const c = content ?? { x: 0, y: 0, w: width, h: height };
  const scale = [1 / (255 * std[0]), 1 / (255 * std[1]), 1 / (255 * std[2])];
  const offset = [mean[0] / std[0], mean[1] / std[1], mean[2] / std[2]];
  for (let y = 0; y < height; y++) {
    const inY = y >= c.y && y < c.y + c.h;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!inY || x < c.x || x >= c.x + c.w) continue; // stays 0 = the mean
      const p = i * 4;
      out[i] = rgba[p] * scale[0] - offset[0];
      out[n + i] = rgba[p + 1] * scale[1] - offset[1];
      out[2 * n + i] = rgba[p + 2] * scale[2] - offset[2];
    }
  }
  return out;
}

/** Model output (one channel) → 0–255 mask. */
export function outputToMask(data: Float32Array | ArrayLike<number>, kind: OutputKind): Uint8Array {
  const n = data.length;
  const out = new Uint8Array(n);
  if (kind === 'minmax') {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const range = hi - lo;
    // A flat output carries no information: treat it as "nothing found" rather than amplifying noise.
    if (!(range > 1e-6)) return out;
    for (let i = 0; i < n; i++) out[i] = Math.round(((data[i] - lo) / range) * 255);
    return out;
  }
  for (let i = 0; i < n; i++) {
    let v = data[i];
    if (kind === 'logits') v = 1 / (1 + Math.exp(-v));
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/**
 * Bilinear resize of the `content` region of a mask (srcW×srcH) to dstW×dstH.
 * Pixel centres are aligned (half-pixel convention), matching how canvases scale images.
 */
export function resizeMask(src: Uint8Array, srcW: number, srcH: number, content: Rect, dstW: number, dstH: number): Uint8Array {
  if (src.length < srcW * srcH) throw new Error('Mask is smaller than its stated size');
  const out = new Uint8Array(dstW * dstH);
  const sx = content.w / dstW;
  const sy = content.h / dstH;
  const maxX = content.x + content.w - 1;
  const maxY = content.y + content.h - 1;
  const xs0 = new Int32Array(dstW);
  const xs1 = new Int32Array(dstW);
  const fx = new Float32Array(dstW);
  for (let x = 0; x < dstW; x++) {
    let u = content.x + (x + 0.5) * sx - 0.5;
    if (u < content.x) u = content.x;
    if (u > maxX) u = maxX;
    const u0 = Math.floor(u);
    xs0[x] = u0;
    xs1[x] = Math.min(u0 + 1, maxX);
    fx[x] = u - u0;
  }
  for (let y = 0; y < dstH; y++) {
    let v = content.y + (y + 0.5) * sy - 0.5;
    if (v < content.y) v = content.y;
    if (v > maxY) v = maxY;
    const v0 = Math.floor(v);
    const v1 = Math.min(v0 + 1, maxY);
    const fy = v - v0;
    const r0 = v0 * srcW;
    const r1 = v1 * srcW;
    const o = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const a = src[r0 + xs0[x]];
      const b = src[r0 + xs1[x]];
      const c = src[r1 + xs0[x]];
      const d = src[r1 + xs1[x]];
      const top = a + (b - a) * fx[x];
      const bot = c + (d - c) * fx[x];
      out[o + x] = Math.round(top + (bot - top) * fy);
    }
  }
  return out;
}
