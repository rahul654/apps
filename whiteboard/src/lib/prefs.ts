export type ThemeChoice = 'system' | 'light' | 'dark';
export type SortMode = 'edited' | 'name' | 'created';

const THEME_KEY = 'whiteboard:theme';
const PREFS_KEY = 'whiteboard:prefs:v1';

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
  sort: SortMode;
}

const DEFAULT_PREFS: Prefs = { sort: 'edited' };

export function getPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    const sort = raw?.sort;
    return { sort: sort === 'name' || sort === 'created' || sort === 'edited' ? sort : DEFAULT_PREFS.sort };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
