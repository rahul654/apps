import { describe, expect, it } from 'vitest';
import { activeSegmentIndex, foldText, highlightParts, searchSegments } from './search';

const segs = [
  { text: 'Welcome to the Café', start: 0, end: 2 },
  { text: 'Today we talk about naïve models', start: 2, end: 5 },
  { text: 'and CAFE culture.', start: 6, end: 8 },
  { text: '', start: 9, end: 10 },
];

describe('search', () => {
  it('folds case and accents', () => {
    expect(foldText('Café NAÏVE')).toBe('cafe naive');
  });
  it('finds segments containing every term', () => {
    expect(searchSegments(segs, 'cafe')).toEqual([0, 2]);
    expect(searchSegments(segs, 'NAIVE models')).toEqual([1]);
    expect(searchSegments(segs, 'models welcome')).toEqual([]);
    expect(searchSegments(segs, '   ')).toEqual([]);
  });
  it('highlights matches using the original characters', () => {
    expect(highlightParts('Welcome to the Café', 'cafe')).toEqual([
      { text: 'Welcome to the ', match: false },
      { text: 'Café', match: true },
    ]);
    expect(highlightParts('aXa xa', 'x')).toEqual([
      { text: 'a', match: false },
      { text: 'X', match: true },
      { text: 'a ', match: false },
      { text: 'x', match: true },
      { text: 'a', match: false },
    ]);
    expect(highlightParts('naïve', 'NAIVE')).toEqual([{ text: 'naïve', match: true }]);
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
  it('handles decomposed input and emoji', () => {
    const decomposed = 'café ☕ time';
    const parts = highlightParts(decomposed, 'time');
    expect(parts.map((p) => p.text).join('')).toBe(decomposed);
    expect(parts[parts.length - 1]).toEqual({ text: 'time', match: true });
  });
});

describe('activeSegmentIndex', () => {
  it('finds the playing segment and bridges short gaps', () => {
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
    expect(activeSegmentIndex(segs, 0)).toBe(0);
    expect(activeSegmentIndex(segs, 1.99)).toBe(0);
    expect(activeSegmentIndex(segs, 2)).toBe(1);
    expect(activeSegmentIndex(segs, 5.5)).toBe(1); // gap before the next segment
    expect(activeSegmentIndex(segs, 7)).toBe(2);
    expect(activeSegmentIndex(segs, 9.5)).toBe(3);
    expect(activeSegmentIndex(segs, 60)).toBe(-1);
    expect(activeSegmentIndex([], 1)).toBe(-1);
  });
});
