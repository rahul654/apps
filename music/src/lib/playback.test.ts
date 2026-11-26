import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import {
  afterToggle,
  clipsFor,
  effectiveMode,
  firstPlayable,
  formatClip,
  formatTime,
  graphScale,
  nextClip,
  nextSong,
  prevClip,
  prevSong,
  seededRng,
  segmentStart,
  shuffleOrder,
  straightOrder,
  type NavContext,
} from './playback';

function song(videoId: string, segments: [number, number][], extra: Partial<Song> = {}): Song {
  return {
    videoId,
    title: videoId,
    name: videoId,
    artist: '',
    duration: 240,
    source: 'heatmap',
    heatmap: [],
    segments: segments.map(([start, end], i) => ({ rank: i + 1, start, end, score: 1 - i * 0.1 })),
    ...extra,
  };
}

/** Rank order differs from time order: rank 1 is the chorus at 1:30. */
const A = song('aaaaaaaaaaa', [
  [90, 120],
  [30, 60],
  [180, 200],
]);
const B = song('bbbbbbbbbbb', [[40, 70]]);
const FALLBACK = song('fffffffffff', [[70, 100]], { source: 'fallback', duration: 235 });
const NONE = new Set<string>();

describe('clipsFor', () => {
  it('hooks plays only the rank-1 segment', () => {
    expect(clipsFor(A, 'hooks', NONE)).toEqual([{ start: 90, end: 120 }]);
  });

  it('peaks plays every segment in time order', () => {
    expect(clipsFor(A, 'peaks', NONE)).toEqual([
      { start: 30, end: 60 },
      { start: 90, end: 120 },
      { start: 180, end: 200 },
    ]);
  });

  it('peaks merges overlapping or touching segments so nothing plays twice', () => {
    const s = song('ccccccccccc', [
      [50, 80],
      [70, 100],
      [100, 110],
    ]);
    expect(clipsFor(s, 'peaks', NONE)).toEqual([{ start: 50, end: 110 }]);
  });

  it('full plays the whole song', () => {
    expect(clipsFor(A, 'full', NONE)).toEqual([{ start: 0, end: 240 }]);
  });

  it('the per-song "Full song" override beats the global mode', () => {
    const full = new Set([A.videoId]);
    expect(effectiveMode(A.videoId, 'hooks', full)).toBe('full');
    expect(clipsFor(A, 'hooks', full)).toEqual([{ start: 0, end: 240 }]);
    expect(clipsFor(A, 'peaks', full)).toEqual([{ start: 0, end: 240 }]);
    expect(clipsFor(B, 'hooks', full)).toEqual([{ start: 40, end: 70 }]);
  });

  it('a fallback song plays its one guessed clip', () => {
    expect(clipsFor(FALLBACK, 'hooks', NONE)).toEqual([{ start: 70, end: 100 }]);
    expect(clipsFor(FALLBACK, 'peaks', NONE)).toEqual([{ start: 70, end: 100 }]);
    expect(clipsFor(FALLBACK, 'full', NONE)).toEqual([{ start: 0, end: 235 }]);
  });
});

describe('afterToggle', () => {
  it('to full mid-clip keeps playing from the current time, ending at the duration', () => {
    expect(afterToggle(A, 'full', 97.4)).toEqual({ action: 'continue', clipIndex: 0, clip: { start: 0, end: 240 } });
  });

  it('back to clips while inside a clip keeps playing and ends at that clip', () => {
    expect(afterToggle(A, 'peaks', 45)).toEqual({ action: 'continue', clipIndex: 0, clip: { start: 30, end: 60 } });
    expect(afterToggle(A, 'hooks', 119.9)).toEqual({ action: 'continue', clipIndex: 0, clip: { start: 90, end: 120 } });
  });

  it('back to clips between clips seeks to the next clip', () => {
    expect(afterToggle(A, 'peaks', 75)).toEqual({ action: 'seek', clipIndex: 1, clip: { start: 90, end: 120 } });
    expect(afterToggle(A, 'hooks', 10)).toEqual({ action: 'seek', clipIndex: 0, clip: { start: 90, end: 120 } });
  });

  it('the clip end is exclusive', () => {
    expect(afterToggle(A, 'peaks', 60)).toEqual({ action: 'seek', clipIndex: 1, clip: { start: 90, end: 120 } });
  });

  it('back to clips after the last clip goes to the next song', () => {
    expect(afterToggle(A, 'peaks', 210)).toEqual({ action: 'next-song' });
    expect(afterToggle(A, 'hooks', 150)).toEqual({ action: 'next-song' });
  });
});

describe('segmentStart', () => {
  it('a chip inside a mode clip plays that clip from the chip', () => {
    expect(segmentStart(A, 'peaks', A.segments[2])).toEqual({ clipIndex: 2, clip: { start: 180, end: 200 }, startAt: 180 });
    expect(segmentStart(A, 'hooks', A.segments[0])).toEqual({ clipIndex: 0, clip: { start: 90, end: 120 }, startAt: 90 });
  });

  it('a chip outside the mode clips plays the segment, then carries on with the next clip', () => {
    const s = segmentStart(A, 'hooks', A.segments[1]);
    expect(s).toEqual({ clipIndex: -1, clip: { start: 30, end: 60 }, startAt: 30 });
    const after = segmentStart(A, 'hooks', A.segments[2]);
    expect(after.clipIndex).toBe(0);
  });

  it('in full mode a chip jumps within the whole song', () => {
    expect(segmentStart(A, 'full', A.segments[1])).toEqual({ clipIndex: 0, clip: { start: 0, end: 240 }, startAt: 30 });
  });
});

describe('queue navigation', () => {
  const songs = [A, B, FALLBACK];
  function ctx(opts: Partial<NavContext<Song>> = {}): NavContext<Song> {
    return {
      items: songs,
      order: straightOrder(songs.length),
      clipCount: (s) => clipsFor(s, 'peaks', NONE).length,
      playable: () => true,
      repeat: false,
      ...opts,
    };
  }

  it('next clip walks the clips of a song, then the next song', () => {
    const c = ctx();
    expect(nextClip(c, { slot: 0, clip: 0 })).toEqual({ slot: 0, clip: 1 });
    expect(nextClip(c, { slot: 0, clip: 2 })).toEqual({ slot: 1, clip: 0 });
    expect(nextClip(c, { slot: 0, clip: -1 })).toEqual({ slot: 0, clip: 0 });
  });

  it('previous clip goes back within the song, then to the last clip of the previous song', () => {
    const c = ctx();
    expect(prevClip(c, { slot: 0, clip: 2 })).toEqual({ slot: 0, clip: 1 });
    expect(prevClip(c, { slot: 1, clip: 0 })).toEqual({ slot: 0, clip: 2 });
    expect(prevClip(c, { slot: 0, clip: 0 })).toBeNull();
  });

  it('next/previous song jump to the first clip', () => {
    const c = ctx();
    expect(nextSong(c, { slot: 0, clip: 1 })).toEqual({ slot: 1, clip: 0 });
    expect(prevSong(c, { slot: 2, clip: 0 })).toEqual({ slot: 1, clip: 0 });
  });

  it('without repeat the queue stops at either end', () => {
    const c = ctx();
    expect(nextClip(c, { slot: 2, clip: 0 })).toBeNull();
    expect(nextSong(c, { slot: 2, clip: 0 })).toBeNull();
    expect(prevSong(c, { slot: 0, clip: 0 })).toBeNull();
  });

  it('with repeat the queue wraps around', () => {
    const c = ctx({ repeat: true });
    expect(nextClip(c, { slot: 2, clip: 0 })).toEqual({ slot: 0, clip: 0 });
    expect(prevSong(c, { slot: 0, clip: 0 })).toEqual({ slot: 2, clip: 0 });
    expect(prevClip(c, { slot: 0, clip: 0 })).toEqual({ slot: 2, clip: 0 });
  });

  it('repeat with a single playable song replays it', () => {
    const c = ctx({ repeat: true, playable: (s) => s === B });
    expect(nextClip(c, { slot: 1, clip: 0 })).toEqual({ slot: 1, clip: 0 });
  });

  it('unavailable songs are skipped', () => {
    const c = ctx({ playable: (s) => s !== B });
    expect(nextClip(c, { slot: 0, clip: 2 })).toEqual({ slot: 2, clip: 0 });
    expect(prevClip(c, { slot: 2, clip: 0 })).toEqual({ slot: 0, clip: 2 });
    expect(firstPlayable(c, 1)).toEqual({ slot: 2, clip: 0 });
    expect(firstPlayable(ctx({ playable: () => false }), 0)).toBeNull();
  });

  it('navigation follows the play order, not the list order', () => {
    const c = ctx({ order: [2, 0, 1] });
    expect(nextClip(c, { slot: 0, clip: 0 })).toEqual({ slot: 1, clip: 0 });
    expect(nextClip(c, { slot: 1, clip: 2 })).toEqual({ slot: 2, clip: 0 });
  });
});

describe('shuffle', () => {
  it('is a permutation that keeps the current song first', () => {
    const order = shuffleOrder(10, 4, seededRng(7));
    expect(order[0]).toBe(4);
    expect([...order].sort((a, b) => a - b)).toEqual(straightOrder(10));
  });

  it('is reproducible with the same seed and differs with another', () => {
    expect(shuffleOrder(12, null, seededRng(1))).toEqual(shuffleOrder(12, null, seededRng(1)));
    expect(shuffleOrder(12, null, seededRng(1))).not.toEqual(shuffleOrder(12, null, seededRng(2)));
    expect(shuffleOrder(12, null, seededRng(1))).not.toEqual(straightOrder(12));
  });

  it('handles tiny lists', () => {
    expect(shuffleOrder(0, null, seededRng(1))).toEqual([]);
    expect(shuffleOrder(1, 0, seededRng(1))).toEqual([0]);
  });

  it('the seeded RNG stays in [0, 1)', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('formatting and graph scale', () => {
  it('formats times and clips', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(38)).toBe('0:38');
    expect(formatTime(68.9)).toBe('1:08');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatClip({ start: 38, end: 68 })).toBe('0:38–1:08');
  });

  it('scales to the max after the intro spike', () => {
    const heat = [1, 0.9, ...Array.from({ length: 98 }, (_, i) => (i === 50 ? 0.4 : 0.1))];
    expect(graphScale(heat)).toBe(0.4);
    expect(graphScale([])).toBe(1);
    expect(graphScale([0, 0, 0, 0])).toBe(1);
  });
});
