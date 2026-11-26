/**
 * Player preferences in localStorage (`music:prefs:v1`). Only preferences: song data never goes
 * into storage. Every access is guarded, so the app works with storage blocked or full.
 */
import { MODES, type Mode } from './playback';

export const PREFS_KEY = 'music:prefs:v1';

export interface Prefs {
  mode: Mode;
  /** Video ids switched to "Full song"; beats `mode` for those songs. */
  fullSong: string[];
  shuffle: boolean;
  repeat: boolean;
}

export const DEFAULT_PREFS: Prefs = { mode: 'hooks', fullSong: [], shuffle: false, repeat: false };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Keeps every valid field and falls back to the default for the rest. */
export function sanitizePrefs(v: unknown): Prefs {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ...DEFAULT_PREFS, fullSong: [] };
  const o = v as Record<string, unknown>;
  const mode = MODES.includes(o.mode as Mode) ? (o.mode as Mode) : DEFAULT_PREFS.mode;
  const fullSong = Array.isArray(o.fullSong) ? [...new Set(o.fullSong.filter((id): id is string => typeof id === 'string' && id !== ''))] : [];
  const shuffle = typeof o.shuffle === 'boolean' ? o.shuffle : DEFAULT_PREFS.shuffle;
  const repeat = typeof o.repeat === 'boolean' ? o.repeat : DEFAULT_PREFS.repeat;
  return { mode, fullSong, shuffle, repeat };
}

export function readPrefs(storage: StorageLike | null = defaultStorage()): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizePrefs(null);
  }
}

/** Returns false when the prefs couldn't be saved (no storage, quota, private mode). */
export function writePrefs(prefs: Prefs, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
