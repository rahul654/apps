/** Tiny namespaced localStorage helpers. All keys are prefixed "filetools:". */

const PREFIX = 'filetools:';

export function getItem(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false; // private mode or quota exceeded
  }
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export type ThemeChoice = 'system' | 'light' | 'dark';

export function getTheme(): ThemeChoice {
  const t = getItem('theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function applyTheme(t: ThemeChoice): void {
  if (t === 'system') {
    delete document.documentElement.dataset.theme;
    removeItem('theme');
  } else {
    document.documentElement.dataset.theme = t;
    setItem('theme', t);
  }
}
