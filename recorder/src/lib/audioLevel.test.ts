import { describe, expect, it } from 'vitest';
import { meterLevel, rms, smoothLevel } from './audioLevel';

describe('audio level', () => {
  it('rms of silence, DC and a full-scale sine', () => {
    expect(rms([])).toBe(0);
    expect(rms([0, 0, 0])).toBe(0);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
    const sine = Array.from({ length: 1000 }, (_, i) => Math.sin((i / 1000) * Math.PI * 2 * 10));
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 3);
  });
  it('maps to a 0..1 dB scale', () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(0.001)).toBeCloseTo(0); // −60 dBFS
    expect(meterLevel(Math.pow(10, -30 / 20))).toBeCloseTo(0.5); // −30 dBFS
    expect(meterLevel(NaN)).toBe(0);
  });
  it('smooths with fast attack and slow release', () => {
    expect(smoothLevel(0, 1)).toBeCloseTo(0.6);
    expect(smoothLevel(1, 0)).toBeCloseTo(0.88);
  });
});
