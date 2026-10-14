import { SCHEMA_VERSION, type BoardMeta, type BoardScene, type SavedAppState, type SceneElement, type SceneFile } from './types';
import { normalizeTitle, DEFAULT_TITLE } from './format';

/** appState keys worth keeping per board. Theme, selection, dialogs, collaborators etc. are not stored. */
export const APP_STATE_KEYS = [
  'viewBackgroundColor',
  'gridModeEnabled',
  'gridSize',
  'gridStep',
  'scrollX',
  'scrollY',
  'zoom',
  'objectsSnapModeEnabled',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemRoundness',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
  'currentItemArrowType',
] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isJsonish = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v) || isObj(v) || Array.isArray(v);

/** Keeps only known, JSON-safe appState keys. Non-finite numbers are dropped. */
export function pickAppState(raw: unknown): SavedAppState {
  const out: SavedAppState = {};
  if (!isObj(raw)) return out;
  for (const k of APP_STATE_KEYS) {
    const v = raw[k];
    if (v === undefined || !isJsonish(v)) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (k === 'zoom' && !(isObj(v) && typeof v.value === 'number' && v.value > 0)) continue;
    out[k] = v;
  }
  return out;
}

/** Keeps elements with a string id and type, and drops deleted ones and duplicate ids. */
export function validateElements(raw: unknown): { elements: SceneElement[]; dropped: number } {
  if (!Array.isArray(raw)) return { elements: [], dropped: 0 };
  const seen = new Set<string>();
  const elements: SceneElement[] = [];
  let dropped = 0;
  for (const el of raw) {
    if (!isObj(el) || typeof el.id !== 'string' || !el.id || typeof el.type !== 'string' || seen.has(el.id)) {
      dropped++;
      continue;
    }
    if (el.isDeleted === true) continue;
    seen.add(el.id);
    elements.push(el as SceneElement);
  }
  return { elements, dropped };
}

/** Accepts Excalidraw's `files` record ({ [id]: file }) or an array. Bad entries are dropped. */
export function validateFiles(raw: unknown): SceneFile[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) ? Object.values(raw) : [];
  const out: SceneFile[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    if (!isObj(f) || typeof f.id !== 'string' || !f.id || seen.has(f.id)) continue;
    if (typeof f.dataURL !== 'string' || !f.dataURL.startsWith('data:')) continue;
    const mimeType = typeof f.mimeType === 'string' ? f.mimeType : f.dataURL.slice(5, f.dataURL.indexOf(';')) || 'application/octet-stream';
    seen.add(f.id);
    out.push({
      id: f.id,
      mimeType,
      dataURL: f.dataURL,
      created: typeof f.created === 'number' ? f.created : Date.now(),
      ...(typeof f.lastRetrieved === 'number' ? { lastRetrieved: f.lastRetrieved } : {}),
    });
  }
  return out;
}

/** Ids of image files that a list of elements refers to. */
export function referencedFileIds(elements: readonly SceneElement[]): Set<string> {
  const ids = new Set<string>();
  for (const el of elements) if (el.type === 'image' && typeof el.fileId === 'string' && !el.isDeleted) ids.add(el.fileId);
  return ids;
}

// ---------- Migrations ----------

export type Migration = (record: Record<string, unknown>) => Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a record from schema version n to n + 1. Records without a
 * `schemaVersion` are treated as version 0 (hand-written or pre-release exports).
 * To change the stored shape: bump SCHEMA_VERSION in types.ts and add MIGRATIONS[old].
 */
export const MIGRATIONS: Record<number, Migration> = {
  0: (r) => {
    const out: Record<string, unknown> = { ...r };
    if (out.title === undefined && typeof r.name === 'string') out.title = r.name;
    if (out.updatedAt === undefined && typeof r.updated === 'number') out.updatedAt = r.updated;
    if (out.createdAt === undefined && typeof r.created === 'number') out.createdAt = r.created;
    delete out.name;
    delete out.updated;
    delete out.created;
    return out;
  },
};

export class SchemaError extends Error {}

/** Runs every migration step from the record's version up to `target`. */
export function migrateRecord(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): Record<string, unknown> {
  if (!isObj(raw)) throw new SchemaError('Not an object');
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (!Number.isInteger(version) || version < 0) throw new SchemaError('Bad schema version');
  if (version > target) throw new SchemaError(`Saved by a newer version of Whiteboard (schema ${version})`);
  let rec: Record<string, unknown> = raw;
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SchemaError(`No migration from schema ${version}`);
    rec = step(rec);
    version++;
  }
  return { ...rec, schemaVersion: target };
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Migrates and validates a stored board summary. Throws SchemaError if unusable. */
export function validateMeta(raw: unknown, now: number = Date.now()): BoardMeta {
  const r = migrateRecord(raw);
  if (typeof r.id !== 'string' || !r.id) throw new SchemaError('Board has no id');
  const createdAt = num(r.createdAt, now);
  const meta: BoardMeta = {
    id: r.id,
    title: normalizeTitle(typeof r.title === 'string' ? r.title : '') || DEFAULT_TITLE,
    createdAt,
    updatedAt: num(r.updatedAt, createdAt),
    elementCount: Math.max(0, Math.floor(num(r.elementCount, 0))),
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Math.floor(num(r.revision, 0))),
  };
  if (typeof r.template === 'string') meta.template = r.template;
  return meta;
}

/** Migrates and validates a stored scene. Invalid elements are dropped, not fatal. */
export function validateScene(raw: unknown, id: string): BoardScene {
  const r = migrateRecord(raw ?? { schemaVersion: SCHEMA_VERSION });
  return { id, elements: validateElements(r.elements).elements, appState: pickAppState(r.appState), schemaVersion: SCHEMA_VERSION };
}
