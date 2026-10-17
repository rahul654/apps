/** Preferences in localStorage, namespaced: the GitHub Pages origin is shared by every app. */
import { DEFAULT_WORKSPACE_ID } from './workspaces';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'apiclient:theme';
export const PREFS_KEY = 'apiclient:prefs:v1';

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
  /** 'direct' = browser fetch; 'proxy' = through the local proxy. */
  mode: 'direct' | 'proxy';
  proxyUrl: string;
  /** Max history entries kept. */
  historyLimit: number;
  /** Word-wrap the response body. */
  wrap: boolean;
  /** The workspace shown in every page. Proxy settings and theme are app-wide. */
  activeWorkspaceId: string;
  /** Height in px of the request body editor (set with its drag handle). */
  editorHeight: number;
}

export const EDITOR_HEIGHT = { min: 100, max: 2000, default: 260 } as const;
export const clampEditorHeight = (h: number): number => Math.round(Math.min(EDITOR_HEIGHT.max, Math.max(EDITOR_HEIGHT.min, h)));

export const DEFAULT_PREFS: Prefs = { mode: 'direct', proxyUrl: 'http://localhost:4399', historyLimit: 500, wrap: true, activeWorkspaceId: DEFAULT_WORKSPACE_ID, editorHeight: EDITOR_HEIGHT.default };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      mode: p.mode === 'proxy' ? 'proxy' : 'direct',
      proxyUrl: typeof p.proxyUrl === 'string' && p.proxyUrl ? p.proxyUrl : DEFAULT_PREFS.proxyUrl,
      historyLimit: typeof p.historyLimit === 'number' && p.historyLimit > 0 ? p.historyLimit : DEFAULT_PREFS.historyLimit,
      wrap: typeof p.wrap === 'boolean' ? p.wrap : true,
      activeWorkspaceId: typeof p.activeWorkspaceId === 'string' && p.activeWorkspaceId ? p.activeWorkspaceId : DEFAULT_WORKSPACE_ID,
      editorHeight: typeof p.editorHeight === 'number' && Number.isFinite(p.editorHeight) ? clampEditorHeight(p.editorHeight) : EDITOR_HEIGHT.default,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
