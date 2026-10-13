/**
 * Preferences in localStorage (key "recorder:prefs:v1"). Device ids only: media is never stored here.
 */
import type { BubbleShape, BubbleSize, ResolutionCap } from './geometry';
import type { ContainerPref, Quality } from './mime';
import type { RecordMode } from './recordingStore';

export interface Prefs {
  mode: RecordMode;
  cameraId: string;
  micId: string;
  micEnabled: boolean;
  /** 0..2 (1 = unity). */
  micGain: number;
  systemAudio: boolean;
  bubbleShape: BubbleShape;
  bubbleSize: BubbleSize;
  /** Top-left as fractions of the output frame. */
  bubbleX: number;
  bubbleY: number;
  bubbleMirror: boolean;
  bubbleBorder: boolean;
  resolution: ResolutionCap;
  fps: 30 | 60;
  quality: Quality;
  container: ContainerPref;
  countdown: boolean;
  /** 0 = no limit. */
  maxMinutes: number;
}

export const PREFS_KEY = 'recorder:prefs:v1';
export const THEME_KEY = 'recorder:theme';

export const DEFAULT_PREFS: Prefs = {
  mode: 'screen-camera',
  cameraId: '',
  micId: '',
  micEnabled: true,
  micGain: 1,
  systemAudio: true,
  bubbleShape: 'circle',
  bubbleSize: 'm',
  bubbleX: 0.03,
  bubbleY: 0.66,
  bubbleMirror: true,
  bubbleBorder: true,
  resolution: '1080',
  fps: 30,
  quality: 'medium',
  container: 'auto',
  countdown: true,
  maxMinutes: 0,
};

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v.length < 512 ? v : d);

/** Validates untrusted JSON into Prefs, field by field (bad fields fall back to defaults). */
export function parsePrefs(raw: string | null): Prefs {
  let o: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) o = parsed as Record<string, unknown>;
  } catch {
    /* corrupted: defaults */
  }
  const d = DEFAULT_PREFS;
  return {
    mode: oneOf(o.mode, ['screen-camera', 'screen', 'camera', 'audio'] as const, d.mode),
    cameraId: str(o.cameraId, d.cameraId),
    micId: str(o.micId, d.micId),
    micEnabled: bool(o.micEnabled, d.micEnabled),
    micGain: num(o.micGain, 0, 2, d.micGain),
    systemAudio: bool(o.systemAudio, d.systemAudio),
    bubbleShape: oneOf(o.bubbleShape, ['circle', 'rounded'] as const, d.bubbleShape),
    bubbleSize: oneOf(o.bubbleSize, ['s', 'm', 'l'] as const, d.bubbleSize),
    bubbleX: num(o.bubbleX, 0, 1, d.bubbleX),
    bubbleY: num(o.bubbleY, 0, 1, d.bubbleY),
    bubbleMirror: bool(o.bubbleMirror, d.bubbleMirror),
    bubbleBorder: bool(o.bubbleBorder, d.bubbleBorder),
    resolution: oneOf(o.resolution, ['720', '1080', 'source'] as const, d.resolution),
    fps: oneOf(o.fps, [30, 60] as const, d.fps),
    quality: oneOf(o.quality, ['low', 'medium', 'high'] as const, d.quality),
    container: oneOf(o.container, ['auto', 'mp4', 'webm'] as const, d.container),
    countdown: bool(o.countdown, d.countdown),
    maxMinutes: Math.round(num(o.maxMinutes, 0, 600, d.maxMinutes)),
  };
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota: preferences just won't persist */
  }
}

export type ThemeChoice = 'system' | 'light' | 'dark';

export function getTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement;
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
}
