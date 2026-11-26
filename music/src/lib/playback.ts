/**
 * Pure playback rules: which stretches of a song play in each mode, how the queue moves, and
 * what happens when a song is switched between clips and full playback while it plays.
 * No DOM, no player: `store/player.ts` drives the YouTube player from these answers.
 */
import type { Segment, Song } from '../types';

/** hooks = rank-1 segment only; peaks = every segment in time order; full = the whole song. */
export type Mode = 'hooks' | 'peaks' | 'full';
export const MODES: readonly Mode[] = ['hooks', 'peaks', 'full'];

/** A stretch to play, whole seconds, end exclusive. */
export interface Clip {
  start: number;
  end: number;
}

/** The per-song "Full song" override beats the global mode. */
export function effectiveMode(videoId: string, mode: Mode, fullSongIds: ReadonlySet<string>): Mode {
  return fullSongIds.has(videoId) ? 'full' : mode;
}

/** Clips for a song in a mode that has already been resolved (see `effectiveMode`). */
export function clipsForMode(song: Song, mode: Mode): Clip[] {
  if (mode === 'full') return [{ start: 0, end: song.duration }];
  if (mode === 'hooks') {
    const top = song.segments.find((s) => s.rank === 1) ?? song.segments[0];
    return top ? [{ start: top.start, end: top.end }] : [];
  }
  const sorted = [...song.segments].sort((a, b) => a.start - b.start);
  const out: Clip[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Clips in play order for a song, given the global mode and the songs switched to "Full song". */
export function clipsFor(song: Song, mode: Mode, fullSongIds: ReadonlySet<string>): Clip[] {
  return clipsForMode(song, effectiveMode(song.videoId, mode, fullSongIds));
}

/** Index of the clip that contains `t` (start ≤ t < end), or -1. */
export function clipAt(clips: readonly Clip[], t: number): number {
  return clips.findIndex((c) => c.start <= t && t < c.end);
}

/** Index of the first clip starting at or after `t`, or -1. */
export function nextClipAfter(clips: readonly Clip[], t: number): number {
  return clips.findIndex((c) => c.start >= t);
}

export type ToggleOutcome =
  /** Keep playing where the video is; only the clip end changes. */
  | { action: 'continue'; clipIndex: number; clip: Clip }
  /** Jump to the start of this clip. */
  | { action: 'seek'; clipIndex: number; clip: Clip }
  /** Nothing of this song is left to play in the new mode. */
  | { action: 'next-song' };

/**
 * A song's effective mode changed while it was loaded at `currentTime`.
 * To full: keep playing, end = duration (no seek). Back to clips: keep playing if inside a clip
 * (ending at that clip's end), else jump to the next clip after `currentTime`, else next song.
 */
export function afterToggle(song: Song, newMode: Mode, currentTime: number): ToggleOutcome {
  const clips = clipsForMode(song, newMode);
  if (newMode === 'full') return { action: 'continue', clipIndex: 0, clip: clips[0] };
  const inside = clipAt(clips, currentTime);
  if (inside >= 0) return { action: 'continue', clipIndex: inside, clip: clips[inside] };
  const ahead = nextClipAfter(clips, currentTime);
  if (ahead >= 0) return { action: 'seek', clipIndex: ahead, clip: clips[ahead] };
  return { action: 'next-song' };
}

export interface SegmentStart {
  /**
   * Where the queue cursor stands. "Next clip" continues from `clipIndex + 1`, so a segment
   * that isn't one of the mode's clips gets the index just before the first clip after it.
   */
  clipIndex: number;
  /** The stretch to play (its end is enforced). */
  clip: Clip;
  /** Where to start the video. */
  startAt: number;
}

/** The user picked one segment's chip: play from its start, then carry on in the song's mode. */
export function segmentStart(song: Song, mode: Mode, segment: Segment): SegmentStart {
  const clips = clipsForMode(song, mode);
  if (mode === 'full') return { clipIndex: 0, clip: clips[0], startAt: segment.start };
  const inside = clips.findIndex((c) => c.start <= segment.start && segment.end <= c.end);
  if (inside >= 0) return { clipIndex: inside, clip: clips[inside], startAt: segment.start };
  const after = nextClipAfter(clips, segment.end);
  return {
    clipIndex: (after >= 0 ? after : clips.length) - 1,
    clip: { start: segment.start, end: segment.end },
    startAt: segment.start,
  };
}

/* ---------------------------------- Queue ---------------------------------- */

/** Position in the queue: `slot` indexes `order`, `clip` the clips of that song. */
export interface Cursor {
  slot: number;
  clip: number;
}

export interface NavContext<T> {
  items: readonly T[];
  /** Play order: slot → index into `items`. */
  order: readonly number[];
  clipCount: (item: T) => number;
  /** False for songs the player refused (removed, embedding blocked); they are skipped. */
  playable: (item: T) => boolean;
  /** Wrap around at either end of the queue instead of stopping. */
  repeat: boolean;
}

function itemAt<T>(ctx: NavContext<T>, slot: number): T {
  return ctx.items[ctx.order[slot]];
}

function usable<T>(ctx: NavContext<T>, slot: number): boolean {
  const item = itemAt(ctx, slot);
  return ctx.playable(item) && ctx.clipCount(item) > 0;
}

/** Walk `dir` from `slot` to the next usable slot (wrapping only with repeat). */
function findSlot<T>(ctx: NavContext<T>, slot: number, dir: 1 | -1): number | null {
  const n = ctx.order.length;
  for (let step = 1; step <= n; step++) {
    let s = slot + dir * step;
    if (s < 0 || s >= n) {
      if (!ctx.repeat) return null;
      s = ((s % n) + n) % n;
    }
    if (usable(ctx, s)) return s;
  }
  return null;
}

/** First usable position at or after `fromSlot` (wrapping only with repeat). */
export function firstPlayable<T>(ctx: NavContext<T>, fromSlot = 0): Cursor | null {
  if (fromSlot >= 0 && fromSlot < ctx.order.length && usable(ctx, fromSlot)) return { slot: fromSlot, clip: 0 };
  const s = findSlot(ctx, fromSlot, 1);
  return s === null ? null : { slot: s, clip: 0 };
}

export function nextSong<T>(ctx: NavContext<T>, c: Cursor): Cursor | null {
  const s = findSlot(ctx, c.slot, 1);
  return s === null ? null : { slot: s, clip: 0 };
}

export function prevSong<T>(ctx: NavContext<T>, c: Cursor): Cursor | null {
  const s = findSlot(ctx, c.slot, -1);
  return s === null ? null : { slot: s, clip: 0 };
}

/** Next clip of this song, else the first clip of the next song; null at the end without repeat. */
export function nextClip<T>(ctx: NavContext<T>, c: Cursor): Cursor | null {
  if (usable(ctx, c.slot) && c.clip + 1 < ctx.clipCount(itemAt(ctx, c.slot))) return { slot: c.slot, clip: Math.max(0, c.clip + 1) };
  return nextSong(ctx, c);
}

/** Previous clip of this song, else the last clip of the previous song; null at the start without repeat. */
export function prevClip<T>(ctx: NavContext<T>, c: Cursor): Cursor | null {
  if (usable(ctx, c.slot) && c.clip > 0) return { slot: c.slot, clip: Math.min(c.clip - 1, ctx.clipCount(itemAt(ctx, c.slot)) - 1) };
  const s = findSlot(ctx, c.slot, -1);
  return s === null ? null : { slot: s, clip: ctx.clipCount(itemAt(ctx, s)) - 1 };
}

/** Identity play order. */
export function straightOrder(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** A shuffled play order with `current` (an item index) first, so the song playing stays current. */
export function shuffleOrder(count: number, current: number | null, rng: () => number): number[] {
  const rest = straightOrder(count).filter((i) => i !== current);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return current !== null && current >= 0 && current < count ? [current, ...rest] : rest;
}

/** Small seeded RNG (mulberry32) for reproducible shuffles in tests. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 83 → "1:23", 3723 → "1:02:03". */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatClip(clip: Clip): string {
  return `${formatTime(clip.start)}–${formatTime(clip.end)}`;
}

/**
 * The y-axis maximum for a replay graph: the first few buckets are always the "everyone
 * pressed play" spike, so scale to the highest value after them (the spike is clipped).
 */
export function graphScale(heatmap: readonly number[]): number {
  const skip = Math.max(2, Math.ceil(heatmap.length * 0.05));
  const rest = heatmap.length > skip ? heatmap.slice(skip) : heatmap;
  const max = rest.reduce((m, v) => (v > m ? v : m), 0);
  return max > 0 ? max : 1;
}
