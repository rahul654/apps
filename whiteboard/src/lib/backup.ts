import { SchemaError, validateFiles, validateMeta, validateScene } from './schema';
import { validateLibraryItems } from './excalidrawFile';
import type { BoardMeta, BoardScene, LibraryItem, SceneFile } from './types';

export const BACKUP_TYPE = 'whiteboard-backup';
export const BACKUP_VERSION = 1;

export interface BackupBoard {
  meta: BoardMeta;
  scene: BoardScene;
  files: SceneFile[];
}

export interface Backup {
  type: typeof BACKUP_TYPE;
  version: number;
  exportedAt: string;
  boards: BackupBoard[];
  library: LibraryItem[];
}

export function isBackup(json: unknown): boolean {
  return typeof json === 'object' && json !== null && (json as { type?: unknown }).type === BACKUP_TYPE;
}

export function makeBackup(boards: BackupBoard[], library: LibraryItem[], now = new Date()): Backup {
  return { type: BACKUP_TYPE, version: BACKUP_VERSION, exportedAt: now.toISOString(), boards, library };
}

/**
 * Validates a parsed backup file. Each board goes through the same migration and validation
 * as stored data; boards that fail are counted in `invalid` and skipped.
 */
export function parseBackup(json: unknown): { backup: Backup; invalid: number } {
  if (!isBackup(json)) throw new SchemaError('Not a Whiteboard backup file.');
  const raw = json as Record<string, unknown>;
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) throw new SchemaError('This backup was made by a newer version of Whiteboard.');
  const boards: BackupBoard[] = [];
  let invalid = 0;
  for (const b of Array.isArray(raw.boards) ? raw.boards : []) {
    try {
      const rec = b as Record<string, unknown>;
      const meta = validateMeta(rec.meta);
      const scene = validateScene(rec.scene, meta.id);
      boards.push({ meta: { ...meta, elementCount: scene.elements.length }, scene, files: validateFiles(rec.files) });
    } catch {
      invalid++;
    }
  }
  return {
    backup: { type: BACKUP_TYPE, version: BACKUP_VERSION, exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '', boards, library: validateLibraryItems(raw.library) },
    invalid,
  };
}
