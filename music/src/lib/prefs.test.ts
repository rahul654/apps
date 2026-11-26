import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, writePrefs, type Prefs } from './prefs';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('prefs', () => {
  it('round-trips', () => {
    const s = memoryStorage();
    const prefs: Prefs = { mode: 'peaks', fullSong: ['i96UO8-GFvw'], shuffle: true, repeat: true };
    expect(writePrefs(prefs, s)).toBe(true);
    expect(JSON.parse(s.map.get(PREFS_KEY)!)).toEqual(prefs);
    expect(readPrefs(s)).toEqual(prefs);
  });

  it('gives defaults when nothing is stored', () => {
    expect(readPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('survives bad stored JSON', () => {
    const s = memoryStorage();
    s.map.set(PREFS_KEY, '{not json');
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
    s.map.set(PREFS_KEY, '[1,2]');
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and replaces invalid ones', () => {
    const s = memoryStorage();
    s.map.set(PREFS_KEY, JSON.stringify({ mode: 'loud', fullSong: ['a', 3, 'a', '', 'b'], shuffle: 'yes', repeat: true }));
    expect(readPrefs(s)).toEqual({ mode: 'hooks', fullSong: ['a', 'b'], shuffle: false, repeat: true });
  });

  it('works when storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readPrefs(throwing)).toEqual(DEFAULT_PREFS);
    expect(writePrefs(DEFAULT_PREFS, throwing)).toBe(false);
    expect(writePrefs(DEFAULT_PREFS, null)).toBe(false);
  });

  it('defaults do not share the fullSong array', () => {
    const a = readPrefs(null);
    a.fullSong.push('x');
    expect(readPrefs(null).fullSong).toEqual([]);
    expect(DEFAULT_PREFS.fullSong).toEqual([]);
  });
});
