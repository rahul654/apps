import { describe, expect, it } from 'vitest';
import { applyEdit, applyPatch, brushCoverage, computeAlpha, cropRect, DEFAULT_REFINE, maskStats, refineLut, resetPatch, Stroke, subjectBounds } from './mask';

describe('refineLut', () => {
  it('is the identity with the defaults', () => {
    const lut = refineLut(DEFAULT_REFINE);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });

  it('becomes a hard step at the threshold with zero softness', () => {
    const lut = refineLut({ threshold: 0.5, softness: 0 });
    expect(lut[127]).toBe(0);
    expect(lut[128]).toBe(255);
    expect(new Set(lut)).toEqual(new Set([0, 255]));
  });

  it('a higher threshold removes faint pixels; the curve is monotonic', () => {
    const lo = refineLut({ threshold: 0.3, softness: 0.2 });
    const hi = refineLut({ threshold: 0.7, softness: 0.2 });
    expect(lo[128]).toBe(255);
    expect(hi[128]).toBe(0);
    for (let i = 1; i < 256; i++) expect(hi[i]).toBeGreaterThanOrEqual(hi[i - 1]);
    // 50 % point sits at the threshold
    expect(hi[Math.round(0.7 * 255)]).toBeGreaterThan(110);
    expect(hi[Math.round(0.7 * 255)]).toBeLessThan(145);
  });

  it('clamps out-of-range settings', () => {
    const lut = refineLut({ threshold: 2, softness: -1 });
    expect(lut[254]).toBe(0);
    expect(lut[255]).toBe(255);
  });
});

describe('applyEdit', () => {
  it('erases, restores and leaves untouched pixels alone', () => {
    expect(applyEdit(200, 0)).toBe(200);
    expect(applyEdit(200, -127)).toBe(0);
    expect(applyEdit(10, 127)).toBe(255);
    expect(applyEdit(100, 64)).toBe(Math.round(100 + (155 * 64) / 127));
    expect(applyEdit(100, -64)).toBe(Math.round((100 * 63) / 127));
  });
});

describe('computeAlpha', () => {
  it('combines raw, refine and edits, writing into an RGBA alpha channel', () => {
    const raw = new Uint8Array([0, 100, 200, 255]);
    const edits = new Int8Array([127, 0, -127, 0]);
    const out = new Uint8ClampedArray(16).fill(9);
    computeAlpha(raw, edits, refineLut(DEFAULT_REFINE), 2, out, undefined, 4, 3);
    expect([out[3], out[7], out[11], out[15]]).toEqual([255, 100, 0, 255]);
    expect(out[0]).toBe(9); // RGB untouched
  });

  it('only touches the given rect', () => {
    const raw = new Uint8Array(9).fill(200);
    const out = new Uint8Array(9);
    computeAlpha(raw, null, refineLut(DEFAULT_REFINE), 3, out, { x: 1, y: 1, w: 2, h: 1 });
    expect([...out]).toEqual([0, 0, 0, 0, 200, 200, 0, 0, 0]);
  });
});

describe('brush', () => {
  it('has a solid core and a soft edge', () => {
    expect(brushCoverage(0, 10)).toBe(1);
    expect(brushCoverage(7, 10)).toBe(1);
    expect(brushCoverage(8.5, 10)).toBeCloseTo(0.5);
    expect(brushCoverage(10, 10)).toBe(0);
  });

  it('erases under the dab and records an undoable patch', () => {
    const w = 20;
    const h = 20;
    const edits = new Int8Array(w * h);
    const s = new Stroke(edits, w, h, 'erase');
    const changed = s.to(10, 10, 4);
    expect(changed).not.toBeNull();
    expect(edits[10 * w + 10]).toBe(-127);
    expect(edits[0]).toBe(0);
    const patch = s.finish()!;
    expect(patch.rect.w).toBeGreaterThan(0);
    const after = edits.slice();
    applyPatch(edits, w, patch, 'undo');
    expect(edits.every((v) => v === 0)).toBe(true);
    applyPatch(edits, w, patch, 'redo');
    expect(edits).toEqual(after);
  });

  it('does not build up when the same stroke passes twice over a soft edge', () => {
    const w = 30;
    const edits = new Int8Array(w * w);
    const s = new Stroke(edits, w, w, 'erase');
    s.to(10, 10, 6);
    s.to(10, 10, 6);
    s.to(10, 10, 6);
    // A pixel in the soft ring keeps the value a single dab gives it.
    const single = new Int8Array(w * w);
    new Stroke(single, w, w, 'erase').to(10, 10, 6);
    const i = 10 * w + 15; // 5.5 px from the centre (the ring is 4.2–6)
    expect(edits[i]).toBeLessThan(0);
    expect(edits[i]).toBeGreaterThan(-127);
    expect(edits[i]).toBe(single[i]);
    // A second stroke over it does build up, as expected.
    new Stroke(edits, w, w, 'erase').to(10, 10, 6);
    expect(edits[i]).toBeLessThan(single[i]);
  });

  it('restoring over an erase goes back towards opaque', () => {
    const w = 10;
    const edits = new Int8Array(w * w).fill(-127);
    const s = new Stroke(edits, w, w, 'restore');
    s.to(5, 5, 3);
    expect(edits[5 * w + 5]).toBe(127);
    expect(applyEdit(0, edits[5 * w + 5])).toBe(255);
  });

  it('interpolates between pointer samples so fast strokes have no gaps', () => {
    const w = 100;
    const edits = new Int8Array(w * 10);
    const s = new Stroke(edits, w, 10, 'erase');
    s.to(5, 5, 3);
    s.to(95, 5, 3);
    for (let x = 5; x <= 95; x++) expect(edits[5 * w + x]).toBe(-127);
  });

  it('ignores dabs fully outside the image', () => {
    const edits = new Int8Array(25);
    const s = new Stroke(edits, 5, 5, 'erase');
    expect(s.to(-50, -50, 3)).toBeNull();
    expect(s.finish()).toBeNull();
  });

  it('reset is a patch over the whole layer, or null if there is nothing to reset', () => {
    const edits = new Int8Array(4);
    expect(resetPatch(edits, 2, 2)).toBeNull();
    edits[1] = -50;
    const p = resetPatch(edits, 2, 2)!;
    applyPatch(edits, 2, p, 'redo');
    expect([...edits]).toEqual([0, 0, 0, 0]);
    applyPatch(edits, 2, p, 'undo');
    expect(edits[1]).toBe(-50);
  });
});

describe('crop to subject', () => {
  const alpha = (w: number, h: number, on: [number, number][]) => {
    const a = new Uint8Array(w * h);
    for (const [x, y] of on) a[y * w + x] = 255;
    return a;
  };

  it('finds the bounding box of visible pixels', () => {
    expect(subjectBounds(alpha(10, 8, [[2, 3], [6, 5], [4, 1]]), 10, 8)).toEqual({ x: 2, y: 1, w: 5, h: 5 });
    expect(subjectBounds(new Uint8Array(12), 4, 3)).toBeNull();
  });

  it('ignores near-transparent fringe below minAlpha', () => {
    const a = alpha(5, 5, [[2, 2]]);
    a[0] = 10;
    expect(subjectBounds(a, 5, 5, 16)).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });

  it('reads an RGBA alpha channel', () => {
    const rgba = new Uint8ClampedArray(3 * 2 * 4);
    rgba[(1 * 3 + 2) * 4 + 3] = 255;
    expect(subjectBounds(rgba, 3, 2, 16, 4, 3)).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it('pads by a percentage of the larger side, optionally past the image edge', () => {
    const b = { x: 10, y: 20, w: 100, h: 50 };
    expect(cropRect(b, 10, 200, 200, false)).toEqual({ x: 0, y: 10, w: 120, h: 70 });
    expect(cropRect({ x: 0, y: 0, w: 100, h: 100 }, 10, 100, 100, false)).toEqual({ x: -10, y: -10, w: 120, h: 120 });
    expect(cropRect({ x: 0, y: 0, w: 100, h: 100 }, 10, 100, 100, true)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('falls back to the whole image when nothing is visible', () => {
    expect(cropRect(null, 10, 30, 40, false)).toEqual({ x: 0, y: 0, w: 30, h: 40 });
  });
});

describe('maskStats', () => {
  it('reports opaque and transparent shares', () => {
    expect(maskStats(new Uint8Array([0, 255, 255, 128]))).toEqual({ opaque: 0.5, transparent: 0.25 });
  });
});
