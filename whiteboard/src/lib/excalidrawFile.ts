import { pickAppState, validateElements, validateFiles } from './schema';
import { newId } from './id';
import type { LibraryItem, SavedAppState, SceneElement, SceneFile } from './types';

export interface ParsedScene {
  kind: 'scene';
  elements: SceneElement[];
  appState: SavedAppState;
  files: SceneFile[];
  /** appState.name from the file, if any. */
  name?: string;
  dropped: number;
}

export interface ParsedLibrary {
  kind: 'library';
  items: LibraryItem[];
}

export class ImportError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses an `.excalidraw` scene (type "excalidraw"). Throws ImportError otherwise. */
export function parseScene(json: unknown): ParsedScene {
  if (!isObj(json) || json.type !== 'excalidraw' || !Array.isArray(json.elements)) {
    throw new ImportError('Not an Excalidraw drawing (.excalidraw).');
  }
  const { elements, dropped } = validateElements(json.elements);
  const app = isObj(json.appState) ? json.appState : {};
  const name = typeof app.name === 'string' && app.name.trim() ? app.name : undefined;
  return { kind: 'scene', elements, appState: pickAppState(app), files: validateFiles(json.files), name, dropped };
}

/** Parses an `.excalidrawlib` file (v1 `library: [[...]]` or v2 `libraryItems`). */
export function parseLibrary(json: unknown): ParsedLibrary {
  if (!isObj(json) || json.type !== 'excalidrawlib') throw new ImportError('Not an Excalidraw library (.excalidrawlib).');
  const raw = Array.isArray(json.libraryItems) ? json.libraryItems : Array.isArray(json.library) ? json.library.map((elements) => ({ elements })) : null;
  if (!raw) throw new ImportError('The library file has no items.');
  return { kind: 'library', items: validateLibraryItems(raw) };
}

export function validateLibraryItems(raw: unknown): LibraryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (!isObj(it)) continue;
    const { elements } = validateElements(it.elements);
    if (!elements.length) continue;
    let id = typeof it.id === 'string' && it.id ? it.id : newId('lib_');
    if (seen.has(id)) id = newId('lib_');
    seen.add(id);
    out.push({ ...it, id, status: it.status === 'published' ? 'published' : 'unpublished', elements, created: typeof it.created === 'number' ? it.created : Date.now() });
  }
  return out;
}

/** The `.excalidraw` JSON Excalidraw itself writes (version 2), so files open in excalidraw.com too. */
export function serializeScene(input: { elements: readonly SceneElement[]; appState: SavedAppState; files: readonly SceneFile[] }, source = 'whiteboard'): string {
  const files: Record<string, SceneFile> = {};
  for (const f of input.files) files[f.id] = { id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created, ...(f.lastRetrieved ? { lastRetrieved: f.lastRetrieved } : {}) };
  const appState: SavedAppState = { gridSize: 20, viewBackgroundColor: '#ffffff' };
  for (const k of ['viewBackgroundColor', 'gridSize', 'gridStep', 'gridModeEnabled'] as const) if (k in input.appState) appState[k] = input.appState[k];
  return JSON.stringify({ type: 'excalidraw', version: 2, source, elements: input.elements, appState, files }, null, 2);
}

export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
