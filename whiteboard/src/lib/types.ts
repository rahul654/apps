/** Current schema version of stored boards. Bump it and add a step in schema.ts MIGRATIONS. */
export const SCHEMA_VERSION = 1;

/** A scene element as stored. Excalidraw's own `restore()` normalises the rest on load. */
export interface SceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  [key: string]: unknown;
}

/** Excalidraw binary file (images), as in its `BinaryFileData`. */
export interface SceneFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
  lastRetrieved?: number;
}

/** The subset of Excalidraw's appState we keep per board (no theme, selection or dialogs). */
export type SavedAppState = Record<string, unknown>;

export interface BoardMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  elementCount: number;
  schemaVersion: number;
  /** Bumped on content changes, so a stale thumbnail can be detected. */
  revision: number;
  /** Template the board started from, if any. */
  template?: string;
}

export interface BoardScene {
  id: string;
  elements: SceneElement[];
  appState: SavedAppState;
  schemaVersion: number;
}

export interface StoredFile extends SceneFile {
  boardId: string;
}

export interface Thumbnail {
  id: string;
  dataURL: string;
  revision: number;
}

export interface LoadedBoard {
  meta: BoardMeta;
  scene: BoardScene;
  files: SceneFile[];
}

/** Library item (Excalidraw `LibraryItem`), kept opaque apart from the id. */
export interface LibraryItem {
  id: string;
  status?: string;
  elements: SceneElement[];
  created?: number;
  name?: string;
  [key: string]: unknown;
}

export interface BoardSnapshot extends LoadedBoard {
  thumbnail: Thumbnail | null;
}
