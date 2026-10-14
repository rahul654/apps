/**
 * Renders a small PNG preview of a scene with Excalidraw's exporter. Lives in the lazy editor
 * chunk: the boards list imports it dynamically only for boards that need a fresh preview.
 */
import { exportToBlob, restoreElements } from '@excalidraw/excalidraw';
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { SavedAppState, SceneElement, SceneFile } from './types';

export const THUMB_SIZE = 480;

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function filesRecord(files: readonly SceneFile[]): BinaryFiles {
  const out: BinaryFiles = {};
  for (const f of files) out[f.id] = f as unknown as BinaryFileData;
  return out;
}

/** Returns a PNG data URL, or null for an empty scene. */
export async function renderThumbnail(elements: readonly SceneElement[], appState: SavedAppState, files: BinaryFiles | readonly SceneFile[]): Promise<string | null> {
  const restored = restoreElements(elements as never, null).filter((e) => !e.isDeleted);
  if (!restored.length) return null;
  const blob = await exportToBlob({
    elements: restored,
    appState: {
      viewBackgroundColor: typeof appState.viewBackgroundColor === 'string' ? appState.viewBackgroundColor : '#ffffff',
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files: Array.isArray(files) ? filesRecord(files) : (files as BinaryFiles),
    mimeType: 'image/png',
    maxWidthOrHeight: THUMB_SIZE,
    exportPadding: 24,
  });
  return blobToDataURL(blob);
}
