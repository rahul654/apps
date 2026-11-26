import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  FALLBACK_LENGTH,
  cleanTitle,
  compactHeatmap,
  fallbackSegment,
  findSegments,
  mergeWithExisting,
  smooth,
} from './lib/segments.mjs';

const DIR = import.meta.dirname;
const FIXTURES = path.join(DIR, '__fixtures__');
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(FIXTURES, f), 'utf8')));

/** Builds a yt-dlp style heatmap with `values` spread evenly over `duration`. */
function makeHeatmap(values, duration) {
  const step = duration / values.length;
  return values.map((value, i) => ({ start_time: i * step, end_time: (i + 1) * step, value }));
}

/** Contract checks shared by real and synthetic inputs. */
function expectValidSegments(segments, duration) {
  expect(segments.length).toBeGreaterThanOrEqual(1);
  expect(segments.length).toBeLessThanOrEqual(3);
  segments.forEach((s, i) => {
    expect(s.rank).toBe(i + 1);
    expect(Number.isInteger(s.start)).toBe(true);
    expect(Number.isInteger(s.end)).toBe(true);
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeLessThanOrEqual(duration);
    expect(s.end - s.start).toBeGreaterThanOrEqual(DEFAULTS.minLength);
    expect(s.end - s.start).toBeLessThanOrEqual(DEFAULTS.maxLength);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
    if (i > 0) expect(s.score).toBeLessThanOrEqual(segments[i - 1].score);
  });
  expect(segments[0].score).toBe(1);
  const byStart = [...segments].sort((a, b) => a.start - b.start);
  for (let i = 1; i < byStart.length; i++) expect(byStart[i].start).toBeGreaterThan(byStart[i - 1].end);
}

describe('findSegments on real heatmaps', () => {
  it('has the required fixtures', () => {
    const ids = fixtures.map((f) => f.videoId);
    expect(ids).toEqual(expect.arrayContaining(['i96UO8-GFvw', 'mRD0-GxqHVo', 'TFr6G5zveS8']));
  });

  for (const fx of fixtures) {
    describe(`${fx.videoId} (${fx.title})`, () => {
      const segments = findSegments(fx.heatmap, fx.duration);

      it('returns 1–3 ranked, non-overlapping clips of 20–45 s inside the song', () => {
        expectValidSegments(segments, fx.duration);
      });

      it('ignores the play-button spike at the start', () => {
        // The raw curve's maximum is the first bucket; no clip may start inside the intro.
        expect(fx.heatmap[0].value).toBe(Math.max(...fx.heatmap.map((b) => b.value)));
        for (const s of segments) expect(s.start).toBeGreaterThanOrEqual(DEFAULTS.introSkip);
      });
    });
  }

  it('finds the known hooks', () => {
    const at = (id) => {
      const fx = fixtures.find((f) => f.videoId === id);
      return findSegments(fx.heatmap, fx.duration);
    };
    // Aaoge Tum Kabhi: first chorus around 0:45, second hump around 2:35.
    const aaoge = at('i96UO8-GFvw');
    expect(aaoge[0].start).toBeLessThanOrEqual(45);
    expect(aaoge[0].end).toBeGreaterThan(45);
    expect(aaoge.some((s) => s.start <= 155 && s.end > 155)).toBe(true);
    // Heat Waves: highest point around 1:50.
    const heat = at('mRD0-GxqHVo');
    expect(heat[0].start).toBeLessThanOrEqual(110);
    expect(heat[0].end).toBeGreaterThan(110);
  });

  it('skips the "skip to the vocals" bump that falls straight after the intro', () => {
    const fx = fixtures.find((f) => f.videoId === 'u7Jl-WDeUo4');
    const segments = findSegments(fx.heatmap, fx.duration);
    // Raw curve: 0.62 at ~9 s, then falling until ~20 s.
    expect(segments[0].start).toBeGreaterThanOrEqual(18);
    const withDecay = findSegments(fx.heatmap, fx.duration, { skipIntroDecay: false });
    expect(withDecay[0].start).toBeLessThan(10);
  });
});

describe('findSegments on synthetic curves', () => {
  it('does not explode a flat noisy curve into many segments', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const values = [1, ...Array.from({ length: 99 }, () => 0.5 + (rand() - 0.5) * 0.04)];
    const segments = findSegments(makeHeatmap(values, 240), 240);
    expectValidSegments(segments, 240);
  });

  it('returns one clip for a single wide hump', () => {
    const values = Array.from({ length: 100 }, (_, i) => (i === 0 ? 1 : 0.3 + 0.6 * Math.exp(-(((i - 50) / 12) ** 2))));
    const segments = findSegments(makeHeatmap(values, 200), 200);
    expect(segments).toHaveLength(1);
    expectValidSegments(segments, 200);
    expect(segments[0].start).toBeLessThanOrEqual(100);
    expect(segments[0].end).toBeGreaterThan(100);
  });

  it('finds three separate peaks in score order', () => {
    const peak = (i, c, h) => h * Math.exp(-(((i - c) / 3) ** 2));
    const values = Array.from({ length: 100 }, (_, i) =>
      i === 0 ? 1 : 0.2 + peak(i, 20, 0.5) + peak(i, 50, 0.7) + peak(i, 80, 0.4),
    );
    const segments = findSegments(makeHeatmap(values, 300), 300);
    expectValidSegments(segments, 300);
    expect(segments).toHaveLength(3);
    const centres = segments.map((s) => (s.start + s.end) / 2);
    expect(centres[0]).toBeCloseTo(151.5, -1);
    expect(centres[1]).toBeCloseTo(61.5, -1);
    expect(centres[2]).toBeCloseTo(241.5, -1);
  });

  it('returns nothing for unusable input', () => {
    expect(findSegments([], 200)).toEqual([]);
    expect(findSegments(makeHeatmap([1, 0, 0], 6), 6)).toEqual([]);
    expect(findSegments(makeHeatmap(new Array(100).fill(0), 200), 200)).toEqual([]);
  });

  it('smooth averages with the neighbours that exist', () => {
    expect(smooth([0, 3, 0, 3], 3)).toEqual([1.5, 1, 2, 1.5]);
  });
});

describe('fallbackSegment', () => {
  it('is one 30 s clip at ~30% of the song with score 0', () => {
    expect(fallbackSegment(258)).toEqual([{ rank: 1, start: 77, end: 77 + FALLBACK_LENGTH, score: 0 }]);
  });

  it('stays inside short songs', () => {
    expect(fallbackSegment(40)).toEqual([{ rank: 1, start: 10, end: 40, score: 0 }]);
    expect(fallbackSegment(12)).toEqual([{ rank: 1, start: 0, end: 12, score: 0 }]);
  });
});

describe('compactHeatmap', () => {
  it('rounds values to 2 decimals in time order', () => {
    const fx = fixtures.find((f) => f.videoId === 'i96UO8-GFvw');
    const compact = compactHeatmap(fx.heatmap);
    expect(compact).toHaveLength(fx.heatmap.length);
    expect(compact.slice(0, 3)).toEqual([1, 0.65, 0.62]);
    expect(compactHeatmap([{ start_time: 5, end_time: 10, value: 0.126 }, { start_time: 0, end_time: 5, value: 0.5 }])).toEqual([
      0.5, 0.13,
    ]);
  });

  it('handles missing data', () => {
    expect(compactHeatmap(undefined)).toEqual([]);
    expect(compactHeatmap(null)).toEqual([]);
  });
});

describe('mergeWithExisting', () => {
  const fresh = {
    videoId: 'abcdefghijk',
    title: 'Artist - Song (Official Video)',
    name: 'Song',
    artist: 'Artist',
    duration: 240,
    source: 'heatmap',
    heatmap: [],
    segments: [
      { rank: 1, start: 60, end: 90, score: 1 },
      { rank: 2, start: 120, end: 150, score: 0.8 },
      { rank: 3, start: 180, end: 210, score: 0.6 },
    ],
  };

  it('returns the new song when there is no old one', () => {
    expect(mergeWithExisting(fresh, undefined)).toBe(fresh);
  });

  it('keeps hand-edited names and artists', () => {
    const merged = mergeWithExisting(fresh, { ...fresh, name: 'My Name', artist: 'Film · Singer', segments: [] });
    expect(merged.name).toBe('My Name');
    expect(merged.artist).toBe('Film · Singer');
    expect(merged.segments).toEqual(fresh.segments);
  });

  it('falls back to the new name when the old one is empty', () => {
    const merged = mergeWithExisting(fresh, { ...fresh, name: '', artist: '' });
    expect(merged.name).toBe('Song');
    expect(merged.artist).toBe('Artist');
  });

  it('keeps edited segments, drops overlapping new ones and re-ranks without gaps', () => {
    const old = {
      ...fresh,
      segments: [
        { rank: 1, start: 55, end: 85, score: 0.9, edited: true },
        { rank: 2, start: 10, end: 40, score: 0.5 },
      ],
    };
    const merged = mergeWithExisting(fresh, old);
    expect(merged.segments).toEqual([
      { rank: 1, start: 55, end: 85, score: 0.9, edited: true },
      { rank: 2, start: 120, end: 150, score: 0.8 },
      { rank: 3, start: 180, end: 210, score: 0.6 },
    ]);
  });

  it('never drops edited segments, even past 3', () => {
    const edited = [0, 1, 2, 3].map((i) => ({ rank: i + 1, start: i * 50, end: i * 50 + 25, score: 0.1 * (i + 1), edited: true }));
    const merged = mergeWithExisting(fresh, { ...fresh, segments: edited });
    expect(merged.segments).toHaveLength(4);
    expect(merged.segments.every((s) => s.edited)).toBe(true);
    expect(merged.segments.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    expect(merged.segments[0].score).toBe(0.4);
  });
});

describe('cleanTitle', () => {
  it.each([
    ['The Local Train - Aaoge Tum Kabhi (Official)', 'Aaoge Tum Kabhi', 'The Local Train'],
    ['Glass Animals - Heat Waves (Official Video)', 'Heat Waves', 'Glass Animals'],
    ['Stephen Sanchez - Until I Found You (Official Video)', 'Until I Found You', 'Stephen Sanchez'],
    ['Gym Class Heroes: Stereo Hearts ft. Adam Levine [OFFICIAL VIDEO]', 'Stereo Hearts', 'Gym Class Heroes'],
    ['Anuv Jain - JO TUM MERE HO (Official Video)', 'Jo Tum Mere Ho', 'Anuv Jain'],
    ['SUNIYAN SUNIYAN (Official Video) Juss x MixSingh', 'Suniyan Suniyan', 'Juss x MixSingh'],
    ['Tum Tak - Full Video Song | Raanjhanaa | Dhanush | Sonam Kapoor | A. R. Rahman', 'Tum Tak', 'Raanjhanaa · Dhanush'],
    ['Sajni (Song): Arijit Singh, Ram Sampath | Laapataa Ladies | Aamir Khan Productions', 'Sajni', 'Arijit Singh, Ram Sampath'],
    ['Abhi Na Jaao Chhod Kar | Dev Anand | Sadhana | Mohd Rafi | Asha Bhosle | Hum Dono (1961)', 'Abhi Na Jaao Chhod Kar', 'Dev Anand · Sadhana'],
    ['One Direction - Night Changes', 'Night Changes', 'One Direction'],
    ['Blue - One Love', 'One Love', 'Blue'],
  ])('%s', (title, name, artist) => {
    expect(cleanTitle(title)).toEqual({ name, artist });
  });

  it('handles empty titles', () => {
    expect(cleanTitle('')).toEqual({ name: '', artist: '' });
  });
});

describe('src/data/catalog.json', () => {
  const catalog = JSON.parse(readFileSync(path.join(DIR, '..', 'src', 'data', 'catalog.json'), 'utf8'));

  it('matches the contract in src/types.ts', () => {
    expect(catalog.version).toBe(1);
    expect(catalog.generatedAt).toMatch(/^(\d{4}-\d{2}-\d{2}|stub)$/);
    for (const cat of catalog.categories) {
      expect(cat.id).toMatch(/^[a-z0-9-]+$/);
      for (const song of cat.songs) {
        expect(song.videoId).toMatch(/^[\w-]{11}$/);
        expect(song.name).not.toBe('');
        expect(['heatmap', 'fallback']).toContain(song.source);
        if (song.source === 'fallback') expect(song.heatmap).toEqual([]);
        for (const v of song.heatmap) expect(v).toBe(Math.round(v * 100) / 100);
        expect(song.segments.length).toBeGreaterThanOrEqual(1);
        song.segments.forEach((s, i) => {
          expect(s.rank).toBe(i + 1);
          expect(s.end).toBeGreaterThan(s.start);
          expect(s.end).toBeLessThanOrEqual(song.duration);
        });
        if (!song.segments.some((s) => s.edited)) expect(song.segments.length).toBeLessThanOrEqual(3);
      }
    }
  });
});
