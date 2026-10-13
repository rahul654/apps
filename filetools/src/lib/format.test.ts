import { moveItem, uid } from './array';
import { describe, expect, it } from 'vitest';
import { baseName, extName, formatBytes, percentSaved, safeFileName, savedLabel, uniqueNames } from './format';

describe('formatBytes', () => {
  it('formats bytes, KB, MB, GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB');
  });
  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('percentSaved / savedLabel', () => {
  it('computes savings and growth', () => {
    expect(percentSaved(1000, 250)).toBe(75);
    expect(percentSaved(1000, 1500)).toBe(-50);
    expect(percentSaved(0, 10)).toBe(0);
    expect(savedLabel(1000, 400)).toBe('60% smaller');
    expect(savedLabel(1000, 1200)).toBe('20% larger');
    expect(savedLabel(10, 10)).toBe('same size');
  });
});

describe('file names', () => {
  it('splits base and extension', () => {
    expect(baseName('photo.final.JPG')).toBe('photo.final');
    expect(extName('photo.final.JPG')).toBe('jpg');
    expect(baseName('.hidden')).toBe('.hidden');
    expect(extName('README')).toBe('');
  });
  it('sanitises names', () => {
    expect(safeFileName('a/b:c?.png')).toBe('a_b_c_.png');
    expect(safeFileName('   ')).toBe('file');
  });
  it('makes batch names unique (case-insensitive)', () => {
    expect(uniqueNames(['a.png', 'A.png', 'a.png', 'b'])).toEqual(['a.png', 'A (2).png', 'a (3).png', 'b']);
    expect(uniqueNames(['x', 'x'])).toEqual(['x', 'x (2)']);
  });
});

describe('moveItem / uid', () => {
  it('moves items immutably and clamps', () => {
    const a = ['a', 'b', 'c', 'd'];
    expect(moveItem(a, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(a, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(a, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(a, 9, 0)).toEqual(a);
    expect(a).toEqual(['a', 'b', 'c', 'd']);
  });
  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => uid()));
    expect(ids.size).toBe(500);
  });
});
