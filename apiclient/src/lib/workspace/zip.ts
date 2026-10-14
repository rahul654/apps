/**
 * "Export everything" / "Import everything". The zip holds one valid Postman file per collection,
 * environment and the globals, plus history, run reports and a manifest, so it is useful without
 * this app. Import also accepts Postman's own "Export data" zip (scanned by content, not by path).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { safeFileName } from '../format';
import { detectPostmanJson, normalizeCollection, normalizeEnvironment } from '../postman/normalize';
import { toCollectionFile, toEnvironmentFile } from '../postman/export';
import type { PmCollection, PmEnvironmentFile } from '../postman/types';
import type { RunReport } from '../runner/runner';
import type { HistoryEntry } from '../../types';

export const APP_NAME = 'apiclient';
export const WORKSPACE_SCHEMA_VERSION = 1;

export interface WorkspaceExport {
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile;
  history: HistoryEntry[];
  runs: RunReport[];
  activeEnvironmentId?: string | null;
}

export interface Manifest {
  app: typeof APP_NAME;
  schemaVersion: number;
  exportedAt: string;
  activeEnvironmentId?: string | null;
  files: { collections: string[]; environments: string[]; globals: string; history: string; runs: string[] };
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) name = base.replace(/(\.[^.]+\.json|\.json)$/, (ext) => ` (${i++})${ext}`);
  used.add(name.toLowerCase());
  return name;
}

export function buildWorkspaceZip(ws: WorkspaceExport, now = new Date()): Uint8Array {
  const entries: Zippable = {};
  const used = new Set<string>();
  const manifest: Manifest = { app: APP_NAME, schemaVersion: WORKSPACE_SCHEMA_VERSION, exportedAt: now.toISOString(), activeEnvironmentId: ws.activeEnvironmentId ?? null, files: { collections: [], environments: [], globals: 'globals.json', history: 'history.json', runs: [] } };
  const put = (name: string, value: unknown) => {
    entries[name] = [strToU8(JSON.stringify(value, null, 2)), { level: 6 }];
  };
  for (const c of ws.collections) {
    const name = uniqueName(`collections/${safeFileName(c.info.name, 'collection')}.postman_collection.json`, used);
    manifest.files.collections.push(name);
    put(name, toCollectionFile(c));
  }
  for (const e of ws.environments) {
    const name = uniqueName(`environments/${safeFileName(e.name, 'environment')}.postman_environment.json`, used);
    manifest.files.environments.push(name);
    put(name, toEnvironmentFile(e, 'environment'));
  }
  put('globals.json', toEnvironmentFile(ws.globals, 'globals'));
  put('history.json', { app: APP_NAME, schemaVersion: WORKSPACE_SCHEMA_VERSION, entries: ws.history });
  for (const r of ws.runs) {
    const name = uniqueName(`runs/${safeFileName(r.id, 'run')}.json`, used);
    manifest.files.runs.push(name);
    put(name, r);
  }
  put('manifest.json', manifest);
  return zipSync(entries);
}

export interface ParsedZip {
  manifest: Manifest | null;
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile | null;
  history: HistoryEntry[];
  runs: RunReport[];
  /** Files that were skipped, with the reason. */
  skipped: { file: string; reason: string }[];
  /** True when it looks like a Postman "Export data" zip rather than ours. */
  fromPostman: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function parseWorkspaceZip(bytes: Uint8Array): ParsedZip {
  const files = unzipSync(bytes);
  const out: ParsedZip = { manifest: null, collections: [], environments: [], globals: null, history: [], runs: [], skipped: [], fromPostman: false };
  for (const [name, data] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.json') || name.endsWith('/')) continue;
    let json: unknown;
    try {
      json = JSON.parse(strFromU8(data));
    } catch {
      out.skipped.push({ file: name, reason: 'not valid JSON' });
      continue;
    }
    const base = name.split('/').pop() ?? name;
    if (isObj(json) && json.app === APP_NAME && base === 'manifest.json') {
      out.manifest = json as unknown as Manifest;
      continue;
    }
    if (isObj(json) && json.app === APP_NAME && Array.isArray(json.entries)) {
      out.history.push(...(json.entries as HistoryEntry[]).filter((e) => isObj(e) && typeof e.id === 'string'));
      continue;
    }
    if (isObj(json) && Array.isArray(json.steps) && typeof json.collectionName === 'string' && typeof json.id === 'string') {
      out.runs.push(json as unknown as RunReport);
      continue;
    }
    const kind = detectPostmanJson(json);
    try {
      if (kind === 'collection') out.collections.push(normalizeCollection(json));
      else if (kind === 'globals' || (kind === 'environment' && /globals/i.test(base))) out.globals = normalizeEnvironment(json, 'globals');
      else if (kind === 'environment') out.environments.push(normalizeEnvironment(json, 'environment'));
      else if (kind === 'collection-v1') out.skipped.push({ file: name, reason: 'Collection v1 format is not supported; export it as v2.1' });
      else if (isObj(json) && (Array.isArray(json.collections) || Array.isArray(json.environments)) && !out.manifest) {
        // Postman "Export data" archive index; the actual files are handled as they come.
        out.fromPostman = true;
      } else out.skipped.push({ file: name, reason: 'not a recognised file' });
    } catch (e) {
      out.skipped.push({ file: name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!out.manifest) out.fromPostman = true;
  return out;
}

export type ImportMode = 'merge' | 'replace';

export interface MergeResult {
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile;
  history: HistoryEntry[];
  runs: RunReport[];
  activeEnvironmentId: string | null;
  summary: { collections: number; environments: number; globals: number; history: number; runs: number; replaced: number };
}

/** Merge keeps existing data and upserts by id (imported wins on conflict); replace starts from the zip only. */
export function mergeWorkspace(current: WorkspaceExport, incoming: ParsedZip, mode: ImportMode): MergeResult {
  const base: WorkspaceExport = mode === 'replace' ? { collections: [], environments: [], globals: { ...current.globals, values: [] }, history: [], runs: [], activeEnvironmentId: null } : current;
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
  const collections = upsert(base.collections, incoming.collections, (c) => c.info._postman_id ?? '');
  const environments = upsert(base.environments, incoming.environments, (e) => e.id ?? '');
  let globals = base.globals;
  if (incoming.globals) {
    const merged = [...globals.values];
    for (const v of incoming.globals.values) {
      const i = merged.findIndex((x) => x.key === v.key);
      if (i >= 0) merged[i] = v;
      else merged.push(v);
    }
    globals = { ...globals, values: merged };
  }
  const history = upsert(base.history, incoming.history, (h) => h.id).sort((a, b) => b.at.localeCompare(a.at));
  const runs = upsert(base.runs, incoming.runs, (r) => r.id);
  const wanted = incoming.manifest?.activeEnvironmentId ?? base.activeEnvironmentId ?? null;
  const activeEnvironmentId = wanted && environments.some((e) => e.id === wanted) ? wanted : (base.activeEnvironmentId && environments.some((e) => e.id === base.activeEnvironmentId) ? base.activeEnvironmentId : null);
  return {
    collections,
    environments,
    globals,
    history,
    runs,
    activeEnvironmentId,
    summary: { collections: incoming.collections.length, environments: incoming.environments.length, globals: incoming.globals?.values.length ?? 0, history: incoming.history.length, runs: incoming.runs.length, replaced },
  };
}
