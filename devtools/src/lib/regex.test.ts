import { describe, expect, it } from 'vitest';
import { highlightSegments, runRegex } from './regex';

describe('runRegex', () => {
  it('finds all matches with numbered and named groups', () => {
    const r = runRegex({ pattern: '(?<user>\\w+)@(\\w+)\\.com', flags: 'g', text: 'a@x.com, bob@yy.com' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches.map((m) => m.text)).toEqual(['a@x.com', 'bob@yy.com']);
    expect(r.matches[1]).toMatchObject({ index: 9, end: 19, groups: ['bob', 'yy'], named: { user: 'bob' } });
    expect(r.groupNames).toEqual(['user']);
    expect(r.groupCount).toBe(2);
  });
  it('returns only the first match without the g flag', () => {
    const r = runRegex({ pattern: '\\d', flags: '', text: 'a1b2' });
    expect(r.ok && r.matches.map((m) => m.text)).toEqual(['1']);
  });
  it('builds a replace preview', () => {
    const r = runRegex({ pattern: '(\\w+)@(\\w+)', flags: 'g', text: 'a@b c@d', replacement: '$2 at $1' });
    expect(r.ok && r.replaced).toBe('b at a d at c');
    const named = runRegex({ pattern: '(?<y>\\d{4})-(?<m>\\d\\d)', flags: '', text: '2024-03', replacement: '$<m>/$<y>' });
    expect(named.ok && named.replaced).toBe('03/2024');
  });
  it('reports invalid patterns instead of throwing', () => {
    const r = runRegex({ pattern: '(unclosed', flags: 'g', text: 'x' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Invalid regular expression|Unterminated group/);
    expect(runRegex({ pattern: 'a', flags: 'gg', text: 'a' }).ok).toBe(false);
  });
  it('handles zero-length matches and caps the count', () => {
    const r = runRegex({ pattern: '', flags: 'g', text: 'abc' });
    expect(r.ok && r.matches.length).toBe(4);
    const capped = runRegex({ pattern: '.', flags: 'gs', text: 'x'.repeat(100), maxMatches: 10 });
    expect(capped.ok && capped.matches.length).toBe(10);
    expect(capped.ok && capped.truncated).toBe(true);
  });
});

describe('highlightSegments', () => {
  it('splits text around matches', () => {
    const r = runRegex({ pattern: 'b+', flags: 'g', text: 'abbcb' });
    if (!r.ok) throw new Error();
    expect(highlightSegments('abbcb', r.matches)).toEqual([
      { text: 'a', match: null },
      { text: 'bb', match: 0 },
      { text: 'c', match: null },
      { text: 'b', match: 1 },
    ]);
  });
});
