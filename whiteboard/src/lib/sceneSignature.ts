import { APP_STATE_KEYS } from './schema';
import type { SavedAppState, SceneElement } from './types';

/** appState keys whose change counts as editing the board (the rest is viewport/tool prefs). */
export const CONTENT_APP_STATE_KEYS = ['viewBackgroundColor', 'gridModeEnabled', 'gridSize', 'gridStep'] as const;

const VOLATILE = new Set(['version', 'versionNonce', 'updated']);

/**
 * A string that changes only when what the board shows changes. Element version counters and
 * timestamps are ignored, so Excalidraw re-measuring text after fonts load (same size) or
 * re-saving an unchanged scene is not treated as an edit.
 */
export function contentSignature(elements: readonly SceneElement[], appState: SavedAppState): string {
  const els = elements.filter((e) => !e.isDeleted);
  const body = JSON.stringify(els, (key, value) => (VOLATILE.has(key) ? undefined : value));
  const app = CONTENT_APP_STATE_KEYS.map((k) => JSON.stringify(appState[k] ?? null)).join('|');
  return `${app}#${body}`;
}

/** Signature of the non-content appState we keep (scroll, zoom, current tool styles). */
export function viewSignature(appState: SavedAppState): string {
  return APP_STATE_KEYS.filter((k) => !(CONTENT_APP_STATE_KEYS as readonly string[]).includes(k))
    .map((k) => JSON.stringify(appState[k] ?? null))
    .join('|');
}
