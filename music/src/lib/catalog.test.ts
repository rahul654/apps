import { describe, expect, it } from 'vitest';
import bundled from '../data/catalog.json';
import { CatalogError, loadCatalog, parseCatalog } from './catalog';

function valid() {
  return {
    version: 1,
    generatedAt: '2026-11-26',
    categories: [
      {
        id: 'new-hindi',
        title: 'New Hindi Hits',
        playlistId: 'PLx',
        songs: [
          {
            videoId: 'i96UO8-GFvw',
            title: 'The Local Train - Aaoge Tum Kabhi',
            name: 'Aaoge Tum Kabhi',
            artist: 'The Local Train',
            duration: 265,
            source: 'heatmap',
            heatmap: [1, 0.8, 0.2, 0.5],
            segments: [
              { rank: 1, start: 38, end: 68, score: 0.93, edited: true },
              { rank: 2, start: 150, end: 178, score: 0.8 },
            ],
          },
          {
            videoId: 'mRD0-GxqHVo',
            title: 'Heat Waves',
            name: 'Heat Waves',
            artist: '',
            duration: 235,
            source: 'fallback',
            heatmap: [],
            segments: [{ rank: 1, start: 70, end: 100, score: 0 }],
          },
        ],
      },
      { id: 'empty', title: 'Empty', playlistId: 'PLy', songs: [] },
    ],
  };
}

type Mutable = ReturnType<typeof valid>;

function rejects(mutate: (c: Mutable) => void, message: RegExp) {
  const c = valid();
  mutate(c);
  expect(() => parseCatalog(c)).toThrow(CatalogError);
  expect(() => parseCatalog(c)).toThrow(message);
}

describe('parseCatalog', () => {
  it('accepts the bundled catalog.json, whatever it currently holds', async () => {
    expect(() => parseCatalog(bundled)).not.toThrow();
    const loaded = await loadCatalog();
    expect(loaded.version).toBe(1);
    expect(loaded.categories.length).toBe(bundled.categories.length);
  });

  it('accepts a hand-built catalog and keeps every song', () => {
    const c = parseCatalog(valid());
    expect(c.categories.map((x) => x.songs.length)).toEqual([2, 0]);
    expect(c.categories[0].songs[0].segments[0]).toEqual({ rank: 1, start: 38, end: 68, score: 0.93, edited: true });
  });

  it('rejects things that are not a catalog', () => {
    expect(() => parseCatalog(null)).toThrow(/catalog: expected an object/);
    expect(() => parseCatalog([])).toThrow(CatalogError);
    rejects((c) => ((c as { version: number }).version = 2), /catalog\.version: expected 1/);
  });

  it('rejects missing fields and names where', () => {
    rejects((c) => delete (c.categories[0].songs[0] as Partial<Mutable['categories'][0]['songs'][0]>).name, /songs\[0\]\.name: expected a string, got nothing/);
    rejects((c) => delete (c.categories[0] as Partial<Mutable['categories'][0]>).songs, /categories\[0\]\.songs: expected an array/);
    rejects((c) => delete (c.categories[0].songs[1] as Partial<Mutable['categories'][0]['songs'][0]>).duration, /songs\[1\]\.duration/);
    rejects((c) => ((c.categories[0].songs[0] as { videoId: string }).videoId = 'short'), /11-character/);
    rejects((c) => ((c.categories[0].songs[0] as { source: string }).source = 'guess'), /source/);
  });

  it('rejects bad ranks', () => {
    rejects((c) => (c.categories[0].songs[0].segments[1].rank = 3), /segments\[1\]\.rank: expected 2/);
    rejects((c) => c.categories[0].songs[0].segments.reverse(), /segments\[0\]\.rank: expected 1/);
  });

  it('rejects an end at or before the start, or past the duration', () => {
    rejects((c) => (c.categories[0].songs[0].segments[0].end = 38), /segments\[0\]\.end: must be after start/);
    rejects((c) => (c.categories[0].songs[0].segments[0].end = 20), /must be after start/);
    rejects((c) => (c.categories[0].songs[0].segments[1].end = 300), /past the song's duration/);
    rejects((c) => (c.categories[0].songs[0].segments[0].start = 38.5), /whole seconds/);
  });

  it('rejects a song without segments', () => {
    rejects((c) => (c.categories[0].songs[0].segments = []), /segments: must have at least one segment/);
  });

  it('rejects bad heatmaps, scores, ids and duplicate categories', () => {
    rejects((c) => (c.categories[0].songs[0].heatmap = [0.5, 1.5]), /heatmap\[1\]/);
    rejects((c) => (c.categories[0].songs[1].heatmap = [0.5]), /must be empty for a "fallback" song/);
    rejects((c) => (c.categories[0].songs[0].segments[0].score = 2), /score/);
    rejects((c) => (c.categories[0].id = 'has space'), /URL-safe/);
    rejects((c) => (c.categories[1].id = 'new-hindi'), /used by another category/);
  });
});
