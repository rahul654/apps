import { describe, expect, it } from 'vitest';
import type { Viewport } from '../types';
import { DEFAULT_VIEWPORT } from './defaults';
import { clampSize, fitScale, frameSize, MAX_SIZE, MIN_SIZE } from './viewports';

const vp = (patch: Partial<Viewport>): Viewport => ({ ...DEFAULT_VIEWPORT, ...patch });

describe('frameSize', () => {
  it('fills for "fill"', () => {
    expect(frameSize(vp({ preset: 'fill' }))).toBeNull();
  });

  it('uses device presets and swaps for landscape', () => {
    expect(frameSize(vp({ preset: 'iphone-15' }))).toEqual({ width: 393, height: 852 });
    expect(frameSize(vp({ preset: 'iphone-15', landscape: true }))).toEqual({ width: 852, height: 393 });
  });

  it('uses (clamped) custom sizes, and treats unknown presets as custom', () => {
    expect(frameSize(vp({ preset: 'custom', width: 500, height: 700 }))).toEqual({ width: 500, height: 700 });
    expect(frameSize(vp({ preset: 'custom', width: 10, height: 99999 }))).toEqual({ width: MIN_SIZE, height: MAX_SIZE });
    expect(frameSize(vp({ preset: 'gone', width: 640, height: 480 }))).toEqual({ width: 640, height: 480 });
  });
});

describe('fitScale', () => {
  const frame = { width: 1000, height: 500 };
  it('shrinks to fit the tighter side and never enlarges', () => {
    expect(fitScale(frame, { width: 500, height: 500 }, true)).toBe(0.5);
    expect(fitScale(frame, { width: 2000, height: 200 }, true)).toBe(0.4);
    expect(fitScale(frame, { width: 4000, height: 4000 }, true)).toBe(1);
  });
  it('is 1 when fit is off or the stage is not measured', () => {
    expect(fitScale(frame, { width: 100, height: 100 }, false)).toBe(1);
    expect(fitScale(frame, { width: 0, height: 0 }, true)).toBe(1);
  });
  it('has a floor', () => {
    expect(fitScale(frame, { width: 1, height: 1 }, true)).toBe(0.1);
  });
});

describe('clampSize', () => {
  it('rounds and clamps, and handles NaN', () => {
    expect(clampSize(375.6)).toBe(376);
    expect(clampSize(Number.NaN)).toBe(MIN_SIZE);
  });
});
