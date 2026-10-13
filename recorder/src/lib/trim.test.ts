import { describe, expect, it } from 'vitest';
import { moveHandle, validateTrim } from './trim';

describe('validateTrim', () => {
  it('accepts a valid range and rounds to ms', () => {
    expect(validateTrim(1.23456, 5.5, 10)).toEqual({ ok: true, start: 1.235, end: 5.5, length: 4.265 });
  });
  it('clamps to the clip', () => {
    expect(validateTrim(-3, 99, 10)).toMatchObject({ ok: false }); // whole clip: nothing to trim
    expect(validateTrim(-3, 8, 10)).toMatchObject({ ok: true, start: 0, end: 8 });
  });
  it('rejects reversed, too short, NaN and unknown duration', () => {
    expect(validateTrim(5, 4, 10).ok).toBe(false);
    expect(validateTrim(5, 5.2, 10).ok).toBe(false);
    expect(validateTrim(NaN, 5, 10).ok).toBe(false);
    expect(validateTrim(0, 5, Infinity).ok).toBe(false);
    expect(validateTrim(0, 5, 0).ok).toBe(false);
  });
  it('error text explains the problem', () => {
    const r = validateTrim(5, 5.2, 10);
    expect(r.ok === false && r.error).toMatch(/at least 0.5 s/);
  });
});

describe('moveHandle', () => {
  it('keeps the handles apart and inside the clip', () => {
    expect(moveHandle('start', 9.9, { start: 0, end: 10 }, 10)).toEqual({ start: 9.5, end: 10 });
    expect(moveHandle('end', 0, { start: 2, end: 10 }, 10)).toEqual({ start: 2, end: 2.5 });
    expect(moveHandle('start', -4, { start: 2, end: 10 }, 10)).toEqual({ start: 0, end: 10 });
    expect(moveHandle('end', 40, { start: 2, end: 8 }, 10)).toEqual({ start: 2, end: 10 });
  });
});
