import { describe, expect, it } from 'vitest';
import { describePages, flattenRanges, parsePageRanges, planSplitEvery, splitFileNames } from './pageRanges';

describe('parsePageRanges', () => {
  it('parses "1-3,5,8-10"', () => {
    expect(parsePageRanges('1-3,5,8-10', 12)).toEqual({ ok: true, ranges: [[0, 1, 2], [4], [7, 8, 9]] });
  });
  it('accepts spaces, en dashes, semicolons and open ends', () => {
    expect(parsePageRanges(' 1 – 2 ; 9- ', 10)).toEqual({ ok: true, ranges: [[0, 1], [8, 9]] });
    expect(parsePageRanges('-2', 5)).toEqual({ ok: true, ranges: [[0, 1]] });
    expect(parsePageRanges('4-last', 5)).toEqual({ ok: true, ranges: [[3, 4]] });
  });
  it('allows reversed ranges', () => {
    expect(parsePageRanges('3-1', 5)).toEqual({ ok: true, ranges: [[2, 1, 0]] });
  });
  it('rejects invalid input with a message', () => {
    for (const bad of ['', '   ', 'abc', '1-2-3', '0', '1.5', '2,x']) {
      const r = parsePageRanges(bad, 10);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });
  it('rejects out-of-range pages', () => {
    const r = parsePageRanges('1-11', 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/out of range/);
    expect(parsePageRanges('1', 0).ok).toBe(false);
  });
  it('flattens with de-duplication', () => {
    const r = parsePageRanges('1-3,2,5', 6);
    expect(r.ok && flattenRanges(r.ranges)).toEqual([0, 1, 2, 4]);
  });
});

describe('split planning', () => {
  it('splits every N pages', () => {
    expect(planSplitEvery(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(planSplitEvery(4, 1)).toEqual([[0], [1], [2], [3]]);
    expect(planSplitEvery(2, 5)).toEqual([[0, 1]]);
    expect(planSplitEvery(0, 2)).toEqual([]);
  });
  it('rejects bad N', () => {
    expect(() => planSplitEvery(5, 0)).toThrow();
    expect(() => planSplitEvery(5, 1.5)).toThrow();
  });
  it('describes groups and names files', () => {
    expect(describePages([0, 1, 2])).toBe('1-3');
    expect(describePages([4])).toBe('5');
    expect(describePages([0, 2, 3, 7])).toBe('1,3-4,8');
    expect(splitFileNames('report', [[0, 1, 2], [4], [0, 2]])).toEqual(['report_p1-3.pdf', 'report_p5.pdf', 'report_p1_3.pdf']);
  });
});
