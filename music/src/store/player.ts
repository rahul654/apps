/**
 * The one player and its queue, kept outside React so changing pages never interrupts playback.
 * Components read it with `usePlayer()` / `useTime()` (useSyncExternalStore). The playback rules
 * live in `lib/playback.ts`; this file only applies them to the YouTube player.
 *
 * Clip ends are enforced by polling `getCurrentTime()` every 250 ms (no `endSeconds`), so a song
 * switched to "Full song" mid-clip just keeps playing with a new end.
 */
import { useSyncExternalStore } from 'react';
import {
  afterToggle,
  clipsFor,
  effectiveMode,
  firstPlayable,
  nextClip,
  nextSong,
  prevClip,
  prevSong,
  segmentStart,
  shuffleOrder,
  straightOrder,
  type Clip,
  type Cursor,
  type Mode,
  type NavContext,
} from '../lib/playback';
import { readPrefs, writePrefs, type Prefs } from '../lib/prefs';
import { createPlayer, describePlayerError, loadYouTubeApi, PlayerState, type YTPlayer } from '../lib/youtube';
import type { Segment, Song } from '../types';

/** A song as it appears in a category; the same video can sit in two categories. */
export interface QueueItem {
  categoryId: string;
  song: Song;
}

export type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';

export interface PlayerSnapshot {
  prefs: Prefs;
  fullSet: ReadonlySet<string>;
  /** The songs being played through, in catalog order. */
  queue: readonly QueueItem[];
  /** Play order (slot → index into `queue`); shuffled when shuffle is on. */
  order: readonly number[];
  cursor: Cursor | null;
  /** The stretch whose end is being enforced. */
  clip: Clip | null;
  status: Status;
  /** The YouTube player itself. */
  player: 'loading' | 'ready' | 'error';
  playerError: string | null;
  /** Video id → player error code, for songs that can't be played here. */
  unavailable: Readonly<Record<string, number>>;
  /** Songs on the page being viewed; the play button starts here when nothing is queued. */
  view: readonly QueueItem[];
}

export const POLL_MS = 250;
/** "Previous" restarts the clip when more than this far into it. */
export const RESTART_THRESHOLD = 3;

function initialState(): PlayerSnapshot {
  const prefs = readPrefs();
  return {
    prefs,
    fullSet: new Set(prefs.fullSong),
    queue: [],
    order: [],
    cursor: null,
    clip: null,
    status: 'idle',
    player: 'loading',
    playerError: null,
    unavailable: {},
    view: [],
  };
}

let state: PlayerSnapshot = initialState();
const listeners = new Set<() => void>();
let time = 0;
const timeListeners = new Set<() => void>();

let player: YTPlayer | null = null;
let loadedVideoId: string | null = null;
let pending: ((p: YTPlayer) => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Set after a load or seek until the player reports a time near the new start. */
let awaiting: { at: number; start: number } | null = null;
let random: () => number = Math.random;

function set(patch: Partial<PlayerSnapshot>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function setTime(t: number) {
  if (Math.abs(t - time) < 0.05) return;
  time = t;
  timeListeners.forEach((l) => l());
}

export function getPlayerState(): PlayerSnapshot {
  return state;
}

export function getTime(): number {
  return time;
}

export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Current playback time in seconds; updates about four times a second while playing. */
export function useTime(): number {
  return useSyncExternalStore(
    (l) => {
      timeListeners.add(l);
      return () => timeListeners.delete(l);
    },
    () => time,
  );
}

export function currentItem(s: PlayerSnapshot = state): QueueItem | null {
  return s.cursor ? (s.queue[s.order[s.cursor.slot]] ?? null) : null;
}

export function clipsOf(song: Song, s: PlayerSnapshot = state): Clip[] {
  return clipsFor(song, s.prefs.mode, s.fullSet);
}

export function navContext(s: PlayerSnapshot = state): NavContext<QueueItem> {
  return {
    items: s.queue,
    order: s.order,
    clipCount: (item) => clipsOf(item.song, s).length,
    playable: (item) => !(item.song.videoId in s.unavailable),
    repeat: s.prefs.repeat,
  };
}

export function canGoNext(s: PlayerSnapshot = state): boolean {
  return !!s.cursor && nextClip(navContext(s), s.cursor) !== null;
}

export function canGoPrev(s: PlayerSnapshot = state): boolean {
  return !!s.cursor;
}

/* ------------------------------ player plumbing ------------------------------ */

function withPlayer(fn: (p: YTPlayer) => void) {
  if (player) fn(player);
  else pending = fn;
}

function startPoll() {
  pollTimer ??= setInterval(tick, POLL_MS);
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function readTime(): number | null {
  if (!player) return null;
  const t = player.getCurrentTime();
  return Number.isFinite(t) ? t : null;
}

function tick() {
  const { clip, status } = state;
  if (!player || !clip) return;
  const t = readTime();
  if (t === null) return;
  setTime(t);
  if (awaiting) {
    const settled = t >= awaiting.start - 1 && t < clip.end;
    if (!settled && Date.now() - awaiting.at < 4000) return;
    awaiting = null;
  }
  if ((status === 'playing' || status === 'loading') && t >= clip.end) advance();
}

/** Start `videoId` at `startAt`: a seek when that video is already loaded, else a load. */
function playAt(videoId: string, startAt: number) {
  awaiting = { at: Date.now(), start: startAt };
  setTime(startAt);
  withPlayer((p) => {
    if (loadedVideoId === videoId) {
      p.seekTo(startAt, true);
      p.playVideo();
    } else {
      p.loadVideoById({ videoId, startSeconds: startAt });
      loadedVideoId = videoId;
    }
  });
  startPoll();
}

function goTo(cursor: Cursor, opts: { clip?: Clip; startAt?: number } = {}) {
  const item = state.queue[state.order[cursor.slot]];
  const clip = opts.clip ?? clipsOf(item.song)[cursor.clip];
  set({ cursor, clip, status: 'loading' });
  playAt(item.song.videoId, opts.startAt ?? clip.start);
}

function stopAtEnd() {
  awaiting = null;
  if (player) player.pauseVideo();
  set({ status: 'ended' });
}

/** The current clip finished. */
function advance() {
  if (!state.cursor) return;
  const next = nextClip(navContext(), state.cursor);
  if (next) goTo(next);
  else stopAtEnd();
}

function onStateChange(s: number) {
  if (s === PlayerState.PLAYING) {
    if (state.status !== 'ended') set({ status: 'playing' });
  } else if (s === PlayerState.PAUSED) {
    if (state.status === 'playing' || state.status === 'loading') set({ status: 'paused' });
  } else if (s === PlayerState.ENDED) {
    if (!awaiting && state.status !== 'ended') advance();
  }
}

function onError(code: number) {
  const item = currentItem();
  loadedVideoId = null;
  awaiting = null;
  if (!item || !state.cursor) return;
  set({ unavailable: { ...state.unavailable, [item.song.videoId]: code } });
  const next = nextSong(navContext(), state.cursor);
  if (next) goTo(next);
  else stopAtEnd();
}

/**
 * Creates the YouTube player inside `host` (the visible player box). Returns the cleanup.
 * Safe under StrictMode's mount → unmount → mount.
 */
export function attachPlayer(host: HTMLElement): () => void {
  let cancelled = false;
  let created: YTPlayer | null = null;
  set({ player: 'loading', playerError: null });
  loadYouTubeApi().then(
    (api) => {
      if (cancelled) return;
      const p = createPlayer(api, host, {
        onReady: () =>
          queueMicrotask(() => {
            if (cancelled) return;
            player = p;
            set({ player: 'ready' });
            const run = pending;
            pending = null;
            run?.(p);
          }),
        onStateChange: (s) => {
          if (player === p) onStateChange(s);
        },
        onError: (code) => {
          if (player === p) onError(code);
        },
      });
      created = p;
    },
    (err: unknown) => {
      if (!cancelled) set({ player: 'error', playerError: err instanceof Error ? err.message : String(err) });
    },
  );
  return () => {
    cancelled = true;
    if (created && player === created) {
      player = null;
      loadedVideoId = null;
      stopPoll();
      if (state.status === 'playing' || state.status === 'loading') set({ status: 'paused' });
    }
    created?.destroy();
    host.replaceChildren();
  };
}

/* ---------------------------------- actions ---------------------------------- */

function savePrefs(prefs: Prefs) {
  writePrefs(prefs);
  set({ prefs, fullSet: new Set(prefs.fullSong) });
}

/** The current song's effective mode changed: keep going without a restart when possible. */
function applyModeChange(before: Mode) {
  const item = currentItem();
  const { cursor } = state;
  if (!item || !cursor || state.status === 'idle' || state.status === 'ended') return;
  const after = effectiveMode(item.song.videoId, state.prefs.mode, state.fullSet);
  if (after === before) return;
  const loaded = player !== null && loadedVideoId === item.song.videoId;
  const t = (loaded ? readTime() : null) ?? state.clip?.start ?? 0;
  const out = afterToggle(item.song, after, t);
  if (out.action === 'next-song') {
    const next = nextSong(navContext(), cursor);
    if (next) goTo(next);
    else stopAtEnd();
    return;
  }
  const nextCursor = { slot: cursor.slot, clip: out.clipIndex };
  if (!loaded) {
    goTo(nextCursor, { clip: out.clip, startAt: out.action === 'continue' ? t : out.clip.start });
    return;
  }
  set({ cursor: nextCursor, clip: out.clip });
  if (out.action === 'seek') {
    awaiting = { at: Date.now(), start: out.clip.start };
    setTime(out.clip.start);
    player?.seekTo(out.clip.start, true);
  }
}

function currentMode(): Mode | null {
  const item = currentItem();
  return item ? effectiveMode(item.song.videoId, state.prefs.mode, state.fullSet) : null;
}

export function setView(items: readonly QueueItem[]) {
  if (items !== state.view) set({ view: items });
}

/** Play `items[index]` (optionally from one of its segments) and queue the rest of `items`. */
export function playFrom(items: readonly QueueItem[], index: number, segment?: Segment) {
  const order = state.prefs.shuffle ? shuffleOrder(items.length, index, random) : straightOrder(items.length);
  set({ queue: items, order });
  const slot = order.indexOf(index);
  const song = items[index].song;
  if (segment) {
    const s = segmentStart(song, effectiveMode(song.videoId, state.prefs.mode, state.fullSet), segment);
    goTo({ slot, clip: s.clipIndex }, { clip: s.clip, startAt: s.startAt });
    return;
  }
  const start = firstPlayable(navContext(), slot);
  if (start) goTo(start);
}

export function togglePlay() {
  const { status, cursor } = state;
  if (!cursor) {
    if (state.view.length > 0) {
      set({ queue: state.view, order: state.prefs.shuffle ? shuffleOrder(state.view.length, null, random) : straightOrder(state.view.length) });
      const start = firstPlayable(navContext(), 0);
      if (start) goTo(start);
    }
    return;
  }
  if (status === 'playing' || status === 'loading') {
    awaiting = null;
    withPlayer((p) => p.pauseVideo());
    set({ status: 'paused' });
  } else if (status === 'paused') {
    const item = currentItem();
    if (item && player && loadedVideoId === item.song.videoId) {
      player.playVideo();
      set({ status: 'loading' });
      startPoll();
    } else {
      goTo(cursor, { clip: state.clip ?? undefined });
    }
  } else {
    const start = firstPlayable(navContext(), status === 'ended' ? 0 : cursor.slot);
    if (start) goTo(start);
  }
}

export function next() {
  if (!state.cursor) return;
  const c = nextClip(navContext(), state.cursor);
  if (c) goTo(c);
}

export function prev() {
  const { cursor, clip } = state;
  if (!cursor || !clip) return;
  const t = readTime() ?? clip.start;
  const c = t - clip.start > RESTART_THRESHOLD ? null : prevClip(navContext(), cursor);
  if (c) goTo(c);
  else goTo(cursor, { clip });
}

export function nextSongAction() {
  if (!state.cursor) return;
  const c = nextSong(navContext(), state.cursor);
  if (c) goTo(c);
}

export function prevSongAction() {
  if (!state.cursor) return;
  const c = prevSong(navContext(), state.cursor);
  if (c) goTo(c);
}

export function setMode(mode: Mode) {
  if (mode === state.prefs.mode) return;
  const before = currentMode();
  savePrefs({ ...state.prefs, mode });
  if (before) applyModeChange(before);
}

export function setFullSong(videoId: string, on: boolean) {
  if (state.fullSet.has(videoId) === on) return;
  const before = currentMode();
  const fullSong = on ? [...state.prefs.fullSong, videoId] : state.prefs.fullSong.filter((id) => id !== videoId);
  savePrefs({ ...state.prefs, fullSong });
  if (before && currentItem()?.song.videoId === videoId) applyModeChange(before);
}

export function toggleShuffle() {
  const shuffle = !state.prefs.shuffle;
  savePrefs({ ...state.prefs, shuffle });
  if (state.queue.length === 0) return;
  const current = state.cursor ? state.order[state.cursor.slot] : null;
  const order = shuffle ? shuffleOrder(state.queue.length, current, random) : straightOrder(state.queue.length);
  const cursor = state.cursor && current !== null ? { ...state.cursor, slot: order.indexOf(current) } : state.cursor;
  set({ order, cursor });
}

export function toggleRepeat() {
  savePrefs({ ...state.prefs, repeat: !state.prefs.repeat });
}

export function errorText(videoId: string, s: PlayerSnapshot = state): string | null {
  const code = s.unavailable[videoId];
  return code === undefined ? null : describePlayerError(code);
}

/** Tests: forget everything (the player itself is owned by the mounted panel). */
export function resetPlayer(rng: () => number = Math.random) {
  stopPoll();
  pending = null;
  loadedVideoId = null;
  awaiting = null;
  random = rng;
  time = 0;
  state = initialState();
  listeners.forEach((l) => l());
}
