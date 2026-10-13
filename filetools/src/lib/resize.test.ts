import { describe, expect, it } from 'vitest';
import { clampToPixels, computeResize, containIn, rotatedSize } from './resize';

describe('computeResize', () => {
  it('keeps size with mode none', () => {
    expect(computeResize(4000, 3000, { kind: 'none' })).toEqual({ width: 4000, height: 3000 });
  });
  it('fits within max width keeping aspect ratio', () => {
    expect(computeResize(4000, 3000, { kind: 'fit', maxWidth: 1600 })).toEqual({ width: 1600, height: 1200 });
  });
  it('fits within max height', () => {
    expect(computeResize(4000, 3000, { kind: 'fit', maxHeight: 600 })).toEqual({ width: 800, height: 600 });
  });
  it('uses the tighter of width and height limits', () => {
    expect(computeResize(3000, 4000, { kind: 'fit', maxWidth: 1000, maxHeight: 1000 })).toEqual({ width: 750, height: 1000 });
    expect(computeResize(1920, 1080, { kind: 'fit', maxWidth: 1280, maxHeight: 1280 })).toEqual({ width: 1280, height: 720 });
  });
  it('does not enlarge unless asked', () => {
    expect(computeResize(800, 600, { kind: 'fit', maxWidth: 1600 })).toEqual({ width: 800, height: 600 });
    expect(computeResize(800, 600, { kind: 'fit', maxWidth: 1600, enlarge: true })).toEqual({ width: 1600, height: 1200 });
  });
  it('treats empty limits as no limit', () => {
    expect(computeResize(800, 600, { kind: 'fit' })).toEqual({ width: 800, height: 600 });
    expect(computeResize(800, 600, { kind: 'fit', maxWidth: 0 })).toEqual({ width: 800, height: 600 });
  });
  it('scales by percentage and rounds, never below 1px', () => {
    expect(computeResize(1000, 333, { kind: 'percent', percent: 50 })).toEqual({ width: 500, height: 167 });
    expect(computeResize(10, 10, { kind: 'percent', percent: 1 })).toEqual({ width: 1, height: 1 });
    expect(computeResize(100, 50, { kind: 'percent', percent: 200 })).toEqual({ width: 200, height: 100 });
  });
  it('rejects bad input', () => {
    expect(() => computeResize(0, 10, { kind: 'none' })).toThrow();
    expect(() => computeResize(10, 10, { kind: 'percent', percent: 0 })).toThrow();
  });
});

describe('helpers', () => {
  it('swaps size for 90/270 rotation', () => {
    expect(rotatedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 270)).toEqual({ width: 300, height: 400 });
  });
  it('clamps huge canvases to the pixel budget', () => {
    const r = clampToPixels(10000, 10000, 16_000_000);
    expect(r.width * r.height).toBeLessThanOrEqual(16_000_000);
    expect(r.width).toBe(4000);
    expect(clampToPixels(100, 100).factor).toBe(1);
  });
  it('contains an image in a box', () => {
    expect(containIn(200, 100, 100, 100)).toEqual({ width: 100, height: 50, scale: 0.5 });
  });
});
