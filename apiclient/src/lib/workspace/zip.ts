/**
 * Workspace zips. Two export layouts (schemaVersion 2), built so a workspace folder can be fed to
 * Postman's "Import → Folders" as is: Postman files only inside it, app-only data elsewhere.
 *
 * All workspaces (manifest kind 'all-workspaces'):
 *   workspaces/<folder>/collections/<name>.postman_collection.json
 *   workspaces/<folder>/environments/<name>.postman_environment.json
 *   workspaces/<folder>/globals.postman_globals.json
 *   _apiclient/<folder>/workspace.json · history.json · runs/<id>.json
 *   manifest.json
 * One workspace (manifest kind 'workspace'): the same with the Postman files at the top level and
 * the app files directly under _apiclient/.
 *
 * Import also reads schemaVersion 1 zips (one data set), zips from scripts/export-from-postman.mjs
 * (manifest.source 'postman-api', one group per Postman workspace) and Postman "Export data" zips
 * (files detected by content). Everything parses into groups; importPlan.ts decides where they go.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { detectPostmanJson, normalizeCollection, normalizeEnvironment } from '../postman/normalize';
import { toCollectionFile, toEnvironmentFile } from '../postman/export';
import type { PmCollection, PmEnvironmentFile, PmRequestObject } from '../postman/types';
import type { RunReport } from '../runner/runner';
import { uuid } from '../id';
import { EMPTY_GLOBALS, isDefaultWorkspace, type WorkspaceData, type WorkspaceMeta } from '../workspaces';
import type { HistoryEntry } from '../../types';

export const APP_NAME = 'apiclient';
export const ZIP_SCHEMA_VERSION = 2;

export interface ExportWorkspace {
  meta: WorkspaceMeta;
  data: WorkspaceData;
}

export interface ManifestWorkspace {
  id: string;
  name: string;
  folder: string;
  isDefault: boolean;
}
export interface AllWorkspacesManifest {
  app: typeof APP_NAME;
  schemaVersion: 2;
  kind: 'all-workspaces';
  exportedAt: string;
  workspaces: ManifestWorkspace[];
}
export interface WorkspaceManifest {
  app: typeof APP_NAME;
  schemaVersion: 2;
  kind: 'workspace';
  exportedAt: string;
  workspace: { id: string; name: string; isDefault: boolean };
}
/** `_apiclient/[<folder>/]workspace.json` */
export interface WorkspaceFile {
  app: typeof APP_NAME;
  schemaVersion: number;
  id: string;
  name: string;
  isDefault: boolean;
  activeEnvironmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- names ----------

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A file or folder name that works on Windows, macOS and Linux: no separators or reserved characters, no leading/trailing dots or spaces, no device names, at most `max` characters. */
export function safePathSegment(name: string, fallback: string, max = 80): string {
  let s = String(name ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const chars = Array.from(s);
  if (chars.length > max) s = chars.slice(0, max).join('').replace(/[.\s]+$/, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** Returns base+ext, or "base (2)"+ext…, unique among `used` ignoring case, and records it. */
export function uniqueSegment(used: Set<string>, base: string, ext = ''): string {
  let candidate = `${base}${ext}`;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

// ---------- export ----------

const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));

/** Writes one workspace: Postman files under `postmanDir`, app-only files under `appDir`. */
function writeWorkspace(entries: Zippable, ws: ExportWorkspace, postmanDir: string, appDir: string) {
  const put = (path: string, value: unknown) => {
    entries[path] = [json(value), { level: 6 }];
  };
  const usedCols = new Set<string>();
  for (const c of ws.data.collections) put(`${postmanDir}collections/${uniqueSegment(usedCols, safePathSegment(c.info.name, 'collection'), '.postman_collection.json')}`, toCollectionFile(c));
  const usedEnvs = new Set<string>();
  for (const e of ws.data.environments) put(`${postmanDir}environments/${uniqueSegment(usedEnvs, safePathSegment(e.name, 'environment'), '.postman_environment.json')}`, toEnvironmentFile(e, 'environment'));
  put(`${postmanDir}globals.postman_globals.json`, toEnvironmentFile({ ...ws.data.globals, name: ws.data.globals.name || 'Globals' }, 'globals'));
  const meta: WorkspaceFile = { app: APP_NAME, schemaVersion: ZIP_SCHEMA_VERSION, id: ws.meta.id, name: ws.meta.name, isDefault: isDefaultWorkspace(ws.meta), activeEnvironmentId: ws.data.activeEnvironmentId, createdAt: ws.meta.createdAt, updatedAt: ws.meta.updatedAt };
  put(`${appDir}workspace.json`, meta);
  put(`${appDir}history.json`, { app: APP_NAME, schemaVersion: ZIP_SCHEMA_VERSION, entries: ws.data.history });
  const usedRuns = new Set<string>();
  for (const r of ws.data.runs) put(`${appDir}runs/${uniqueSegment(usedRuns, safePathSegment(r.id, 'run'), '.json')}`, r);
}

export function buildAllWorkspacesZip(list: ExportWorkspace[], now = new Date()): Uint8Array {
  const entries: Zippable = {};
  const usedFolders = new Set<string>();
  const manifest: AllWorkspacesManifest = { app: APP_NAME, schemaVersion: 2, kind: 'all-workspaces', exportedAt: now.toISOString(), workspaces: [] };
  for (const ws of list) {
    const folder = uniqueSegment(usedFolders, safePathSegment(ws.meta.name, 'workspace'));
    manifest.workspaces.push({ id: ws.meta.id, name: ws.meta.name, folder, isDefault: isDefaultWorkspace(ws.meta) });
    writeWorkspace(entries, ws, `workspaces/${folder}/`, `_apiclient/${folder}/`);
  }
  entries['manifest.json'] = [json(manifest), { level: 6 }];
  return zipSync(entries);
}

export function buildWorkspaceZip(ws: ExportWorkspace, now = new Date()): Uint8Array {
  const entries: Zippable = {};
  writeWorkspace(entries, ws, '', '_apiclient/');
  const manifest: WorkspaceManifest = { app: APP_NAME, schemaVersion: 2, kind: 'workspace', exportedAt: now.toISOString(), workspace: { id: ws.meta.id, name: ws.meta.name, isDefault: isDefaultWorkspace(ws.meta) } };
  entries['manifest.json'] = [json(manifest), { level: 6 }];
  return zipSync(entries);
}

export const zipFileName = (label: string, now = new Date()) => `apiclient-${safePathSegment(label, 'workspace').replace(/\s+/g, '-')}-${now.toISOString().slice(0, 10)}.zip`;

// ---------- import ----------

/** What an import contains: one group per source workspace (or a single group). */
export interface ParsedGroup {
  key: string;
  name: string;
  /** App workspace id, from an apiclient export. */
  id?: string;
  isDefault?: boolean;
  createdAt?: string;
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile | null;
  history: HistoryEntry[];
  runs: RunReport[];
  activeEnvironmentId?: string | null;
  /** Requests from curl, appended to the target's "Imported" collection. */
  requests?: { id: string; name: string; request: PmRequestObject }[];
}

export type ImportKind = 'all-workspaces' | 'workspace' | 'apiclient-v1' | 'postman-api' | 'postman' | 'files';

export interface ParsedImport {
  kind: ImportKind;
  groups: ParsedGroup[];
  /** Files that were skipped, with the reason. */
  skipped: { file: string; reason: string }[];
  /** Suggested name for a new target workspace. */
  suggestedName: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function emptyGroup(key: string, name: string): ParsedGroup {
  return { key, name, collections: [], environments: [], globals: null, history: [], runs: [] };
}

function mergeGlobals(a: PmEnvironmentFile | null, b: PmEnvironmentFile): PmEnvironmentFile {
  if (!a) return b;
  const values = [...a.values];
  for (const v of b.values) {
    const i = values.findIndex((x) => x.key === v.key);
    if (i >= 0) values[i] = v;
    else values.push(v);
  }
  return { ...a, values };
}

/** Adds one parsed JSON file to a group; returns a skip reason, or null when used (or deliberately ignored). */
export function addJsonToGroup(g: ParsedGroup, path: string, data: unknown): string | null {
  const base = path.split('/').pop() ?? path;
  if (isObj(data) && data.app === APP_NAME) {
    if (base === 'manifest.json') return null;
    if (base === 'workspace.json' && typeof data.id === 'string') {
      const w = data as unknown as WorkspaceFile;
      g.id = w.id;
      if (typeof w.name === 'string' && w.name) g.name = w.name;
      g.isDefault = w.isDefault === true;
      if (typeof w.createdAt === 'string') g.createdAt = w.createdAt;
      g.activeEnvironmentId = typeof w.activeEnvironmentId === 'string' ? w.activeEnvironmentId : null;
      return null;
    }
    if (Array.isArray(data.entries)) {
      g.history.push(...(data.entries as HistoryEntry[]).filter((e) => isObj(e) && typeof e.id === 'string' && typeof e.at === 'string'));
      return null;
    }
  }
  if (isObj(data) && Array.isArray(data.steps) && typeof data.collectionName === 'string' && typeof data.id === 'string') {
    g.runs.push(data as unknown as RunReport);
    return null;
  }
  const kind = detectPostmanJson(data);
  try {
    if (kind === 'collection') g.collections.push(normalizeCollection(data));
    else if (kind === 'globals' || (kind === 'environment' && /globals/i.test(base))) g.globals = mergeGlobals(g.globals, normalizeEnvironment(data, 'globals'));
    else if (kind === 'environment') g.environments.push(normalizeEnvironment(data, 'environment'));
    else if (kind === 'collection-v1') return 'Collection v1 format is not supported; export it as v2.1';
    else if (kind === 'openapi') return 'OpenAPI files are imported on their own, not from a zip';
    else if (isObj(data) && (Array.isArray(data.collections) || Array.isArray(data.environments))) return null; // Postman "Export data" index
    else return 'not a recognised file';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

/** Same rule as scripts/export-from-postman.mjs uses for its folder names. */
const scriptSafeName = (s: string) => (s || 'untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);

const stem = (fileName: string) => fileName.replace(/^.*[\\/]/, '').replace(/\.(zip|json|ya?ml)$/i, '').replace(/\.postman_(collection|environment|globals)$/i, '').trim() || 'Imported';

export function parseImportZip(bytes: Uint8Array, fileName = 'import.zip'): ParsedImport {
  const files = unzipSync(bytes);
  const skipped: ParsedImport['skipped'] = [];
  const docs: { path: string; data: unknown }[] = [];
  for (const [path, raw] of Object.entries(files)) {
    if (path.endsWith('/') || !path.toLowerCase().endsWith('.json') || /(^|\/)__MACOSX\//.test(path)) continue;
    try {
      docs.push({ path, data: JSON.parse(strFromU8(raw)) });
    } catch {
      skipped.push({ file: path, reason: 'not valid JSON' });
    }
  }
  // The manifest nearest the root decides the layout; a zip of a folder has everything one level down.
  const manifestDoc = docs
    .filter((d) => (d.path === 'manifest.json' || d.path.endsWith('/manifest.json')) && isObj(d.data) && d.data.app === APP_NAME)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
  const manifest = manifestDoc && isObj(manifestDoc.data) ? manifestDoc.data : null;
  const prefix = manifestDoc ? manifestDoc.path.slice(0, -'manifest.json'.length) : '';
  const rel = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p);

  const groups = new Map<string, ParsedGroup>();
  const group = (key: string, name: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = emptyGroup(key, name)));
    return g;
  };
  let kind: ImportKind;
  let route: (path: string, data: unknown) => ParsedGroup;
  let suggestedName = stem(fileName);

  if (manifest?.schemaVersion === 2 && manifest.kind === 'all-workspaces' && Array.isArray(manifest.workspaces)) {
    kind = 'all-workspaces';
    for (const w of manifest.workspaces as ManifestWorkspace[]) {
      if (!isObj(w) || typeof w.folder !== 'string') continue;
      const g = group(w.folder, typeof w.name === 'string' && w.name ? w.name : w.folder);
      if (typeof w.id === 'string') g.id = w.id;
      g.isDefault = w.isDefault === true;
    }
    route = (p) => {
      const m = /^(?:workspaces|_apiclient)\/([^/]+)\//.exec(rel(p));
      return m ? group(m[1], m[1]) : group('', 'Other files');
    };
  } else if (manifest?.schemaVersion === 2 && manifest.kind === 'workspace') {
    kind = 'workspace';
    const w = isObj(manifest.workspace) ? manifest.workspace : {};
    const g = group('main', typeof w.name === 'string' && w.name ? w.name : suggestedName);
    if (typeof w.id === 'string') g.id = w.id;
    g.isDefault = w.isDefault === true;
    route = () => g;
  } else if (manifest?.source === 'postman-api' && Array.isArray(manifest.workspaces)) {
    kind = 'postman-api';
    const byFile = new Map<string, ParsedGroup>();
    const byGlobalsId = new Map<string, ParsedGroup>();
    const bySegment = new Map<string, ParsedGroup>();
    (manifest.workspaces as unknown[]).forEach((w, i) => {
      if (!isObj(w)) return;
      const name = typeof w.name === 'string' && w.name ? w.name : `Postman workspace ${i + 1}`;
      const g = group(`pm:${i}`, name);
      for (const list of [w.collections, w.environments]) if (Array.isArray(list)) for (const f of list) if (isObj(f) && typeof f.file === 'string') byFile.set(f.file, g);
      if (typeof w.id === 'string') byGlobalsId.set(`globals-${w.id}`, g);
      if (!bySegment.has(scriptSafeName(name))) bySegment.set(scriptSafeName(name), g);
    });
    route = (p, data) => {
      const r = rel(p);
      const hit = byFile.get(r);
      if (hit) return hit;
      if (isObj(data) && typeof data.id === 'string' && byGlobalsId.has(data.id)) return byGlobalsId.get(data.id)!;
      const m = /^(?:collections|environments)\/([^/]+)\//.exec(r) ?? /^globals\/(.+?)(?: \(\d+\))?\.postman_globals\.json$/.exec(r);
      if (m) return bySegment.get(m[1]) ?? group(`seg:${m[1]}`, m[1]);
      return group('', 'Other files');
    };
  } else {
    kind = manifest ? 'apiclient-v1' : 'postman';
    const g = group('main', suggestedName);
    if (manifest && typeof manifest.activeEnvironmentId === 'string') g.activeEnvironmentId = manifest.activeEnvironmentId;
    route = () => g;
  }

  for (const d of docs) {
    if (d === manifestDoc) continue;
    const reason = addJsonToGroup(route(d.path, d.data), d.path, d.data);
    if (reason) skipped.push({ file: d.path, reason });
  }
  // A catch-all group that ended up empty is noise.
  const other = groups.get('');
  if (other && !groupSize(other)) groups.delete('');
  const list = [...groups.values()];
  if (kind === 'workspace' && list[0]) suggestedName = list[0].name;
  return { kind, groups: list, skipped, suggestedName };
}

export function groupSize(g: ParsedGroup): number {
  return g.collections.length + g.environments.length + (g.globals ? 1 : 0) + g.history.length + g.runs.length + (g.requests?.length ?? 0);
}

/** One group holding every group's content; later groups win on equal ids. */
export function flattenGroups(groups: ParsedGroup[], name = 'Imported'): ParsedGroup {
  const out = emptyGroup('flat', name);
  const first = groups.find((g) => g.isDefault) ?? groups[0];
  out.activeEnvironmentId = first?.activeEnvironmentId;
  for (const g of groups) {
    out.collections.push(...g.collections);
    out.environments.push(...g.environments);
    if (g.globals) out.globals = mergeGlobals(out.globals, g.globals);
    out.history.push(...g.history);
    out.runs.push(...g.runs);
    if (g.requests) (out.requests ??= []).push(...g.requests);
  }
  return out;
}

// ---------- merge ----------

export type ImportMode = 'merge' | 'replace';

export interface MergeSummary {
  collections: number;
  environments: number;
  globals: number;
  history: number;
  runs: number;
  requests: number;
  replaced: number;
}
export interface MergeResult extends WorkspaceData {
  summary: MergeSummary;
}

export const IMPORTED_COLLECTION = 'Imported';

/** Merge keeps the workspace's data and upserts by id (imported wins on conflict); replace starts from the import only. */
export function mergeWorkspace(current: WorkspaceData, incoming: ParsedGroup, mode: ImportMode): MergeResult {
  const base: WorkspaceData = mode === 'replace' ? { collections: [], environments: [], globals: { ...current.globals, values: [] }, history: [], runs: [], activeEnvironmentId: null } : current;
  let replaced = 0;
  const upsert = <T>(list: T[], items: T[], key: (x: T) => string): T[] => {
    const out = [...list];
    for (const it of items) {
      const i = out.findIndex((x) => key(x) === key(it));
      if (i >= 0) {
        out[i] = it;
        replaced++;
      } else out.push(it);
    }
    return out;
  };
  let collections = upsert(base.collections, incoming.collections, (c) => c.info._postman_id ?? '');
  if (incoming.requests?.length) {
    const existing = collections.find((c) => c.info.name === IMPORTED_COLLECTION);
    const target: PmCollection = existing ?? { info: { _postman_id: uuid(), name: IMPORTED_COLLECTION, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] };
    const next = { ...target, item: [...target.item, ...incoming.requests.map((r) => ({ id: r.id, name: r.name, request: r.request, response: [] }))] };
    collections = existing ? collections.map((c) => (c === existing ? next : c)) : [...collections, next];
  }
  const environments = upsert(base.environments, incoming.environments, (e) => e.id ?? '');
  const globals = incoming.globals ? { ...mergeGlobals(base.globals, incoming.globals), id: 'globals', name: base.globals.name || 'Globals', _postman_variable_scope: 'globals' as const } : base.globals;
  const history = upsert(base.history, incoming.history, (h) => h.id).sort((a, b) => b.at.localeCompare(a.at));
  const runs = upsert(base.runs, incoming.runs, (r) => r.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const has = (id: string | null | undefined): id is string => !!id && environments.some((e) => e.id === id);
  const activeEnvironmentId = has(incoming.activeEnvironmentId) ? incoming.activeEnvironmentId : has(base.activeEnvironmentId) ? base.activeEnvironmentId : null;
  return {
    collections,
    environments,
    globals: globals ?? EMPTY_GLOBALS,
    history,
    runs,
    activeEnvironmentId,
    summary: { collections: incoming.collections.length, environments: incoming.environments.length, globals: incoming.globals?.values.length ?? 0, history: incoming.history.length, runs: incoming.runs.length, requests: incoming.requests?.length ?? 0, replaced },
  };
}
