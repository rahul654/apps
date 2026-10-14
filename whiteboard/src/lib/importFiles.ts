import { isBackup, parseBackup } from './backup';
import type { BoardStore } from './boardStore';
import { ImportError, parseLibrary, parseScene, readFileText } from './excalidrawFile';
import { titleFromFileName } from './format';
import type { BoardMeta } from './types';

export interface ImportSummary {
  boards: BoardMeta[];
  fromBackups: number;
  skipped: number;
  libraryItems: number;
  errors: string[];
}

export const ACCEPT = '.excalidraw,.excalidrawlib,.json,application/json';

/**
 * Imports dropped or picked files: `.excalidraw` drawings become boards, `.excalidrawlib`
 * files go into the shape library, and Whiteboard backups restore their boards.
 */
export async function importFiles(store: BoardStore, files: readonly File[]): Promise<ImportSummary> {
  const out: ImportSummary = { boards: [], fromBackups: 0, skipped: 0, libraryItems: 0, errors: [] };
  for (const file of files) {
    try {
      let json: unknown;
      try {
        json = JSON.parse(await readFileText(file));
      } catch {
        throw new ImportError('it isn’t an Excalidraw or backup file');
      }
      const type = (json as { type?: unknown } | null)?.type;
      if (isBackup(json)) {
        const { backup, invalid } = parseBackup(json);
        const r = await store.importBackup(backup);
        out.fromBackups += r.imported;
        out.skipped += r.skipped;
        out.libraryItems += r.libraryItems;
        if (invalid) out.errors.push(`${file.name}: ${invalid} damaged board${invalid === 1 ? '' : 's'} skipped`);
      } else if (type === 'excalidrawlib') {
        out.libraryItems += await store.addToLibrary(parseLibrary(json).items);
      } else if (type === 'excalidraw') {
        const scene = parseScene(json);
        out.boards.push(await store.create({ title: scene.name ?? titleFromFileName(file.name), elements: scene.elements, appState: scene.appState, files: scene.files }));
      } else {
        throw new ImportError('it isn’t an Excalidraw or backup file');
      }
    } catch (e) {
      out.errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeImport(s: ImportSummary): string {
  const parts: string[] = [];
  const boards = s.boards.length + s.fromBackups;
  if (boards) parts.push(`Imported ${plural(boards, 'board')}`);
  if (s.skipped) parts.push(`${plural(s.skipped, 'board')} already here`);
  if (s.libraryItems) parts.push(`added ${plural(s.libraryItems, 'library item')}`);
  let msg = parts.length ? `${parts.join(', ')}.` : '';
  if (msg) msg = msg[0].toUpperCase() + msg.slice(1);
  if (s.errors.length) msg = `${msg ? `${msg} ` : ''}Couldn’t import ${s.errors.join('; ')}.`;
  return msg || 'Nothing to import.';
}
