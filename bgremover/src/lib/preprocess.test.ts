import { describe, expect, it } from 'vitest';
import { MODELS } from './models';
import { outputToMask, planInput, resizeMask, rgbaToTensor } from './preprocess';

describe('planInput', () => {
  it('stretches into a fixed input', () => {
    expect(planInput(1280, 853, { mode: 'fixed', width: 320, height: 320, fit: 'stretch' })).toEqual({ width: 320, height: 320, content: { x: 0, y: 0, w: 320, h: 320 } });
  });

  it('letterboxes landscape and portrait images, centred', () => {
    const land = planInput(1000, 500, { mode: 'fixed', width: 320, height: 320, fit: 'letterbox' });
    expect(land.content).toEqual({ x: 0, y: 80, w: 320, h: 160 });
    const port = planInput(300, 900, { mode: 'fixed', width: 300, height: 300, fit: 'letterbox' });
    expect(port.content).toEqual({ x: 100, y: 0, w: 100, h: 300 });
    // Odd leftovers go to the bottom/right.
    const odd = planInput(3, 2, { mode: 'fixed', width: 10, height: 10, fit: 'letterbox' });
    expect(odd.content.y + odd.content.h).toBeLessThanOrEqual(10);
    expect(odd.content).toEqual({ x: 0, y: 1, w: 10, h: 7 });
  });

  it('scales the shortest edge to a multiple, like the MODNet processor', () => {
    const spec = { mode: 'shortEdge', short: 512, multiple: 32, maxLong: 1024 } as const;
    expect(planInput(1280, 853, spec)).toMatchObject({ width: 768, height: 512 });
    expect(planInput(853, 1280, spec)).toMatchObject({ width: 512, height: 768 });
    expect(planInput(512, 512, spec)).toMatchObject({ width: 512, height: 512 });
    // Small images are scaled up too (the model expects ~512 px faces).
    expect(planInput(100, 100, spec)).toMatchObject({ width: 512, height: 512 });
  });

  it('caps panoramas at maxLong and never returns 0', () => {
    const spec = { mode: 'shortEdge', short: 512, multiple: 32, maxLong: 1024 } as const;
    const p = planInput(8000, 1000, spec);
    expect(p.width).toBe(1024);
    expect(p.height).toBe(128);
    const thin = planInput(10000, 10, spec);
    expect(thin.height).toBe(32);
    expect(thin.width).toBeLessThanOrEqual(1024);
  });

  it('rejects empty images', () => {
    expect(() => planInput(0, 10, MODELS[0].input)).toThrow();
  });
});

describe('rgbaToTensor', () => {
  it('normalises into CHW order', () => {
    // 2×1 image: red, then mid grey
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255]);
    const t = rgbaToTensor(rgba, 2, 1, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(t).toHaveLength(6);
    // R plane, G plane, B plane
    expect(t[0]).toBeCloseTo(1);
    expect(t[1]).toBeCloseTo(128 / 127.5 - 1);
    expect(t[2]).toBeCloseTo(-1);
    expect(t[4]).toBeCloseTo(-1);
  });

  it('uses ImageNet mean/std and leaves letterbox padding at 0 (the mean)', () => {
    const rgba = new Uint8ClampedArray(3 * 1 * 4).fill(255);
    const t = rgbaToTensor(rgba, 3, 1, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], { x: 1, y: 0, w: 1, h: 1 });
    expect(t[0]).toBe(0);
    expect(t[2]).toBe(0);
    expect(t[1]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(t[3 + 1]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(t[6 + 1]).toBeCloseTo((1 - 0.406) / 0.225, 5);
  });
});

describe('outputToMask', () => {
  it('maps probabilities and clamps', () => {
    expect([...outputToMask(new Float32Array([0, 0.5, 1, -0.2, 1.3]), 'probability')]).toEqual([0, 128, 255, 0, 255]);
  });
  it('applies a sigmoid to logits', () => {
    expect([...outputToMask(new Float32Array([0, 20, -20]), 'logits')]).toEqual([128, 255, 0]);
  });
  it('stretches min–max', () => {
    expect([...outputToMask(new Float32Array([1, 2, 3]), 'minmax')]).toEqual([0, 128, 255]);
  });
  it('treats a flat output as empty instead of amplifying noise', () => {
    expect([...outputToMask(new Float32Array([0.3, 0.3, 0.3]), 'minmax')]).toEqual([0, 0, 0]);
  });
});

describe('resizeMask', () => {
  it('is the identity at the same size', () => {
    const m = new Uint8Array([0, 50, 100, 150, 200, 250]);
    expect([...resizeMask(m, 3, 2, { x: 0, y: 0, w: 3, h: 2 }, 3, 2)]).toEqual([...m]);
  });

  it('interpolates when upscaling, with clamped edges', () => {
    const m = new Uint8Array([0, 255]);
    const out = resizeMask(m, 2, 1, { x: 0, y: 0, w: 2, h: 1 }, 4, 1);
    expect([...out]).toEqual([0, 64, 191, 255]);
  });

  it('keeps a constant mask constant at any size', () => {
    const m = new Uint8Array(16).fill(77);
    const out = resizeMask(m, 4, 4, { x: 0, y: 0, w: 4, h: 4 }, 37, 11);
    expect(out.every((v) => v === 77)).toBe(true);
  });

  it('reads only the letterboxed content region', () => {
    // 4×4 mask whose middle 2 rows are the image (255), padding rows are 0.
    const m = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    const out = resizeMask(m, 4, 4, { x: 0, y: 1, w: 4, h: 2 }, 8, 4);
    expect(out.every((v) => v === 255)).toBe(true);
  });

  it('downscales by averaging neighbours near pixel centres', () => {
    const m = new Uint8Array([0, 255, 0, 255]);
    const out = resizeMask(m, 4, 1, { x: 0, y: 0, w: 4, h: 1 }, 2, 1);
    expect(out[0]).toBeGreaterThan(100);
    expect(out[0]).toBeLessThan(160);
  });
});
