/** Preferences in localStorage (namespaced: the GitHub Pages origin is shared by every app). */
import type { BackendChoice, Task, TimestampMode } from '../types';
import { MODELS } from './models';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'transcribe:theme';
export const PREFS_KEY = 'transcribe:prefs:v1';

export function getTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: ThemeChoice): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* preference just won't persist */
  }
}

export interface Prefs {
  model: string;
  /** '' = detect automatically. */
  language: string;
  task: Task;
  timestamps: TimestampMode;
  backend: BackendChoice;
  dictationLang: string;
  keepAudio: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  model: MODELS[0].id,
  language: '',
  task: 'transcribe',
  timestamps: 'segment',
  backend: 'auto',
  dictationLang: '',
  keepAudio: true,
};

/** Validates stored prefs field by field; anything unknown falls back to the default. */
export function parsePrefs(raw: unknown): Prefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    model: MODELS.some((m) => m.id === r.model) ? (r.model as string) : DEFAULT_PREFS.model,
    language: typeof r.language === 'string' && /^[a-z]{0,3}$/.test(r.language) ? r.language : '',
    task: r.task === 'translate' ? 'translate' : 'transcribe',
    timestamps: r.timestamps === 'word' ? 'word' : 'segment',
    backend: r.backend === 'webgpu' || r.backend === 'wasm' ? r.backend : 'auto',
    dictationLang: typeof r.dictationLang === 'string' && /^[a-zA-Z-]{0,12}$/.test(r.dictationLang) ? r.dictationLang : '',
    keepAudio: r.keepAudio !== false,
  };
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* not persisted */
  }
}
