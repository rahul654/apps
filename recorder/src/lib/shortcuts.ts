/**
 * Keyboard shortcuts. Uses `event.code` (physical key) so Alt/Option combos work on macOS,
 * where Option+Shift+R types "‰" in `event.key`.
 */

export type ShortcutAction = 'toggle-record' | 'toggle-pause' | 'skip-countdown' | 'cancel-countdown';

export interface KeyLike {
  code: string;
  key?: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  /** Tag name of the focused element, e.g. "INPUT". */
  targetTag?: string;
  targetEditable?: boolean;
}

export const SHORTCUTS: Array<{ action: ShortcutAction; keys: string; label: string }> = [
  { action: 'toggle-record', keys: 'Alt+Shift+R', label: 'Start / stop recording' },
  { action: 'toggle-pause', keys: 'Alt+Shift+P', label: 'Pause / resume' },
  { action: 'skip-countdown', keys: 'Space', label: 'Skip the countdown' },
  { action: 'cancel-countdown', keys: 'Esc', label: 'Cancel the countdown' },
];

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Maps a key event to an action, given whether a countdown is showing. */
export function matchShortcut(e: KeyLike, ctx: { countdown: boolean }): ShortcutAction | null {
  if (e.repeat) return null;
  const typing = e.targetEditable || (e.targetTag ? TYPING_TAGS.has(e.targetTag.toUpperCase()) : false);
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    // Alt+Shift combos work even while typing in a field: they don't produce useful text.
    if (e.code === 'KeyR') return 'toggle-record';
    if (e.code === 'KeyP') return 'toggle-pause';
    return null;
  }
  if (ctx.countdown && !e.altKey && !e.ctrlKey && !e.metaKey && !typing) {
    if (e.code === 'Space' || e.code === 'Enter') return 'skip-countdown';
    if (e.code === 'Escape') return 'cancel-countdown';
  }
  return null;
}

/** Shortcut text with the platform's modifier name ("⌥⇧R" on macOS). */
export function shortcutLabel(keys: string, mac: boolean): string {
  if (!mac) return keys;
  return keys.replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Ctrl+', '⌃');
}
