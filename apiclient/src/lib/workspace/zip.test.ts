import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import realistic from '../postman/__fixtures__/realistic.postman_collection.json';
import envFixture from '../postman/__fixtures__/env.postman_environment.json';
import globalsFixture from '../postman/__fixtures__/globals.postman_globals.json';
import { normalizeCollection, normalizeEnvironment } from '../postman/normalize';
import { toCollectionFile } from '../postman/export';
import { validateCollection, validateEnvironment } from '../postman/validate';
import type { HistoryEntry } from '../../types';
import { DEFAULT_WORKSPACE_ID, emptyWorkspaceData, type WorkspaceData, type WorkspaceMeta } from '../workspaces';
import { planImport } from './importPlan';
import { buildAllWorkspacesZip, buildWorkspaceZip, mergeWorkspace, parseImportZip, safePathSegment, uniqueSegment, type ExportWorkspace } from './zip';

const history: HistoryEntry[] = [
  { id: 'h1', at: '2024-01-01T00:00:00.000Z', method: 'GET', url: 'https://a', status: 200, statusText: 'OK', ok: true, time: 5, size: 2, timings: { total: 5, source: 'wall-clock' }, via: 'direct', request: { headers: [], body: null }, response: { headers: [], bodyText: '{}', contentType: 'application/json', binary: false } },
];
const runs = [{ id: 'run-1', collectionId: 'c', collectionName: 'C', startedAt: '2024-01-02T00:00:00.000Z', finishedAt: 'b', iterations: 1, delayMs: 0, steps: [], totals: { requests: 0, passed: 0, failed: 0, errors: 0 }, stopped: 'completed' as const, schemaVersion: 1 as const }];
const data: WorkspaceData = {
  collections: [normalizeCollection(realistic), normalizeCollection({ info: { name: 'Realistic API', schema: 'x' }, item: [] })],
  environments: [normalizeEnvironment(envFixture)],
  globals: normalizeEnvironment(globalsFixture, 'globals'),
  history,
  runs,
  activeEnvironmentId: envFixture.id,
};
const meta = (id: string, name: string, isDefault = false): WorkspaceMeta => ({ id, name, ...(isDefault ? { isDefault } : {}), createdAt: `2024-01-0${id === DEFAULT_WORKSPACE_ID ? 1 : 2}T00:00:00.000Z`, updatedAt: '2024-01-03T00:00:00.000Z' });
const other: WorkspaceData = { ...emptyWorkspaceData(), environments: [{ id: 'env-b', name: 'Prod: EU/West', values: [{ key: 'k', value: 'v' }] }], activeEnvironmentId: 'env-b', globals: { id: 'globals', name: 'Globals', values: [{ key: 'g', value: 'b' }], _postman_variable_scope: 'globals' } };
const all: ExportWorkspace[] = [
  { meta: meta(DEFAULT_WORKSPACE_ID, 'Default', true), data },
  { meta: meta('ws-b', 'Team: B/2'), data: other },
  { meta: meta('ws-c', 'team- b-2'), data: emptyWorkspaceData() }, // sanitises to the same folder name, ignoring case
];

const read = (files: Record<string, Uint8Array>, n: string) => JSON.parse(strFromU8(files[n]));

/** Postman's folder import must only see Postman files; checks every file in a Postman folder against the official/hand-written schemas. */
function expectPostmanFolder(files: Record<string, Uint8Array>, dir: string) {
  const inside = Object.keys(files).filter((n) => n.startsWith(dir) && !n.startsWith(`${dir}_apiclient/`) && n !== `${dir}manifest.json`);
  expect(inside.length).toBeGreaterThan(0);
  for (const n of inside) {
    const rest = n.slice(dir.length);
    if (/^collections\/[^/]+\.postman_collection\.json$/.test(rest)) expect(validateCollection(read(files, n)), n).toEqual([]);
    else if (/^environments\/[^/]+\.postman_environment\.json$/.test(rest)) {
      expect(validateEnvironment(read(files, n)), n).toEqual([]);
      expect(read(files, n)._postman_variable_scope).toBe('environment');
    } else if (rest === 'globals.postman_globals.json') {
      expect(validateEnvironment(read(files, n)), n).toEqual([]);
      expect(read(files, n)._postman_variable_scope).toBe('globals');
    } else throw new Error(`non-Postman file inside a Postman folder: ${n}`);
  }
}

describe('file and folder names', () => {
  it('are filesystem-safe', () => {
    expect(safePathSegment('a/b\\c:d*e?f"g<h>i|j', 'x')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(safePathSegment('  ..hidden. ', 'x')).toBe('hidden');
    expect(safePathSegment('...', 'fallback')).toBe('fallback');
    expect(safePathSegment('CON', 'x')).toBe('_CON');
    expect(safePathSegment('nul.txt', 'x')).toBe('_nul.txt');
    expect(Array.from(safePathSegment('é'.repeat(200), 'x'))).toHaveLength(80);
    expect(safePathSegment('emoji 🚀 ok', 'x')).toBe('emoji 🚀 ok');
  });
  it('are de-duplicated ignoring case', () => {
    const used = new Set<string>();
    expect([uniqueSegment(used, 'A', '.json'), uniqueSegment(used, 'a', '.json'), uniqueSegment(used, 'A', '.json')]).toEqual(['A.json', 'a (2).json', 'A (3).json']);
  });
});

describe('all-workspaces zip', () => {
  const files = unzipSync(buildAllWorkspacesZip(all, new Date('2024-06-01T00:00:00Z')));

  it('has the documented layout and a manifest with original names', () => {
    expect(Object.keys(files).sort()).toEqual([
      '_apiclient/Default/history.json',
      '_apiclient/Default/runs/run-1.json',
      '_apiclient/Default/workspace.json',
      '_apiclient/Team- B-2/history.json',
      '_apiclient/Team- B-2/workspace.json',
      '_apiclient/team- b-2 (2)/history.json',
      '_apiclient/team- b-2 (2)/workspace.json',
      'manifest.json',
      'workspaces/Default/collections/Realistic API (2).postman_collection.json',
      'workspaces/Default/collections/Realistic API.postman_collection.json',
      'workspaces/Default/environments/Staging.postman_environment.json',
      'workspaces/Default/globals.postman_globals.json',
      'workspaces/Team- B-2/environments/Prod- EU-West.postman_environment.json',
      'workspaces/Team- B-2/globals.postman_globals.json',
      'workspaces/team- b-2 (2)/globals.postman_globals.json',
    ]);
    expect(read(files, 'manifest.json')).toEqual({
      app: 'apiclient',
      schemaVersion: 2,
      kind: 'all-workspaces',
      exportedAt: '2024-06-01T00:00:00.000Z',
      workspaces: [
        { id: DEFAULT_WORKSPACE_ID, name: 'Default', folder: 'Default', isDefault: true },
        { id: 'ws-b', name: 'Team: B/2', folder: 'Team- B-2', isDefault: false },
        { id: 'ws-c', name: 'team- b-2', folder: 'team- b-2 (2)', isDefault: false },
      ],
    });
    expect(read(files, 'workspaces/Team- B-2/environments/Prod- EU-West.postman_environment.json').name).toBe('Prod: EU/West');
    expect(read(files, '_apiclient/Team- B-2/workspace.json')).toMatchObject({ app: 'apiclient', id: 'ws-b', name: 'Team: B/2', isDefault: false, activeEnvironmentId: 'env-b' });
    expect(read(files, '_apiclient/Default/history.json').entries).toEqual(history);
  });

  it('every file under workspaces/<folder>/ is a valid Postman file, and nothing else is there', () => {
    for (const w of read(files, 'manifest.json').workspaces) expectPostmanFolder(files, `workspaces/${w.folder}/`);
    const folders = new Set(Object.keys(files).filter((n) => n.startsWith('workspaces/')).map((n) => n.split('/')[1]));
    expect(folders.size).toBe(3);
  });

  it('round-trips through restore into an empty app', () => {
    const parsed = parseImportZip(buildAllWorkspacesZip(all), 'backup.zip');
    expect(parsed.kind).toBe('all-workspaces');
    expect(parsed.skipped).toEqual([]);
    const fresh = { workspaces: [meta(DEFAULT_WORKSPACE_ID, 'Default', true)], data: { [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData() } };
    const ops = planImport(fresh, parsed, { strategy: 'restore', mode: 'merge', target: { kind: 'existing', id: DEFAULT_WORKSPACE_ID }, now: 'now' });
    expect(ops.map((o) => [o.ws, o.name, !!o.create])).toEqual([[DEFAULT_WORKSPACE_ID, 'Default', false], ['ws-b', 'Team: B/2', true], ['ws-c', 'team- b-2', true]]);
    const d = ops[0].data;
    expect(d.collections.map(toCollectionFile)).toEqual(data.collections.map(toCollectionFile));
    expect(d.environments.map((e) => [e.id, e.name, e.values])).toEqual(data.environments.map((e) => [e.id, e.name, e.values]));
    expect(d.globals.values).toEqual(data.globals.values);
    expect(d.history).toEqual(history);
    expect(d.runs).toEqual(runs);
    expect(d.activeEnvironmentId).toBe(envFixture.id);
    expect(ops[1].data.activeEnvironmentId).toBe('env-b');
    expect(ops[1].data.globals.values).toEqual([{ key: 'g', value: 'b', type: 'default', enabled: true }]);
    expect(ops[1].create?.createdAt).toBe('2024-01-02T00:00:00.000Z');
    expect(ops[2].data).toEqual({ ...emptyWorkspaceData(), globals: { ...emptyWorkspaceData().globals, values: [] } });
  });
});

describe('single-workspace zip', () => {
  const files = unzipSync(buildWorkspaceZip({ meta: meta('ws-b', 'Team: B/2'), data }, new Date('2024-06-01T00:00:00Z')));

  it('has Postman files at the top level and app data under _apiclient/', () => {
    expect(Object.keys(files).sort()).toEqual([
      '_apiclient/history.json',
      '_apiclient/runs/run-1.json',
      '_apiclient/workspace.json',
      'collections/Realistic API (2).postman_collection.json',
      'collections/Realistic API.postman_collection.json',
      'environments/Staging.postman_environment.json',
      'globals.postman_globals.json',
      'manifest.json',
    ]);
    expect(read(files, 'manifest.json')).toEqual({ app: 'apiclient', schemaVersion: 2, kind: 'workspace', exportedAt: '2024-06-01T00:00:00.000Z', workspace: { id: 'ws-b', name: 'Team: B/2', isDefault: false } });
    expectPostmanFolder(files, '');
  });

  it('round-trips into a new workspace named after it', () => {
    const parsed = parseImportZip(buildWorkspaceZip({ meta: meta('ws-b', 'Team B'), data }), 'apiclient-Team-B-2024-06-01.zip');
    expect(parsed.kind).toBe('workspace');
    expect(parsed.suggestedName).toBe('Team B');
    expect(parsed.skipped).toEqual([]);
    const app = { workspaces: [meta(DEFAULT_WORKSPACE_ID, 'Default', true)], data: { [DEFAULT_WORKSPACE_ID]: data } };
    const [op] = planImport(app, parsed, { strategy: 'target', mode: 'merge', target: { kind: 'new', name: parsed.suggestedName }, newId: () => 'new-1', now: 'now' });
    expect(op.create).toEqual({ id: 'new-1', name: 'Team B', createdAt: 'now', updatedAt: 'now' });
    expect(op.data.collections.map(toCollectionFile)).toEqual(data.collections.map(toCollectionFile));
    expect(op.data.history).toEqual(history);
    expect(op.data.runs).toEqual(runs);
    expect(op.data.activeEnvironmentId).toBe(envFixture.id);
  });
});

describe('older and foreign zips', () => {
  /** A zip exactly as the schemaVersion 1 app wrote it (single data set). */
  function v1Zip(): Uint8Array {
    const put = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
    return zipSync({
      'collections/Realistic API.postman_collection.json': put(toCollectionFile(data.collections[0])),
      'environments/Staging.postman_environment.json': put({ ...data.environments[0], _postman_variable_scope: 'environment' }),
      'globals.json': put({ ...data.globals, _postman_variable_scope: 'globals' }),
      'history.json': put({ app: 'apiclient', schemaVersion: 1, entries: history }),
      'runs/run-1.json': put(runs[0]),
      'manifest.json': put({ app: 'apiclient', schemaVersion: 1, exportedAt: '2024-06-01T00:00:00.000Z', activeEnvironmentId: envFixture.id, files: { collections: ['collections/Realistic API.postman_collection.json'], environments: ['environments/Staging.postman_environment.json'], globals: 'globals.json', history: 'history.json', runs: ['runs/run-1.json'] } }),
    });
  }

  it('reads a schemaVersion 1 zip as one group, into the chosen workspace', () => {
    const parsed = parseImportZip(v1Zip(), 'apiclient-workspace-2024-06-01.zip');
    expect(parsed.kind).toBe('apiclient-v1');
    expect(parsed.skipped).toEqual([]);
    expect(parsed.groups).toHaveLength(1);
    const g = parsed.groups[0];
    expect([g.collections.length, g.environments.length, g.globals?.values.length, g.history.length, g.runs.length, g.activeEnvironmentId]).toEqual([1, 1, 1, 1, 1, envFixture.id]);
    const app = { workspaces: [meta(DEFAULT_WORKSPACE_ID, 'Default', true), meta('b', 'B')], data: { [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData(), b: emptyWorkspaceData() } };
    const ops = planImport(app, parsed, { strategy: 'target', mode: 'replace', target: { kind: 'existing', id: 'b' } });
    expect(ops.map((o) => o.ws)).toEqual(['b']);
    expect(ops[0].data.activeEnvironmentId).toBe(envFixture.id);
  });

  it('reads a zip of an exported folder (everything one level down)', () => {
    const files = unzipSync(buildAllWorkspacesZip(all));
    const nested = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [`apiclient-all/${k}`, v])));
    const parsed = parseImportZip(nested);
    expect(parsed.kind).toBe('all-workspaces');
    expect(parsed.groups.map((g) => [g.name, g.collections.length, g.environments.length])).toEqual([['Default', 2, 1], ['Team: B/2', 0, 1], ['team- b-2', 0, 0]]);
  });

  it('reads a Postman "Export data" zip (files anywhere, detected by content) and reports skipped files', () => {
    const zip = zipSync({
      'Postman export/collection/My.postman_collection.json': strToU8(JSON.stringify(realistic)),
      'Postman export/environment/E.postman_environment.json': strToU8(JSON.stringify(envFixture)),
      'Postman export/globals/G.postman_globals.json': strToU8(JSON.stringify(globalsFixture)),
      'Postman export/archive.json': strToU8(JSON.stringify({ collection: {}, environment: {} })),
      'Postman export/notes.json': strToU8('not json'),
      'Postman export/readme.txt': strToU8('hi'),
    });
    const parsed = parseImportZip(zip, 'Postman export.zip');
    expect(parsed.kind).toBe('postman');
    expect(parsed.suggestedName).toBe('Postman export');
    const g = parsed.groups[0];
    expect(g.collections).toHaveLength(1);
    expect(g.environments).toHaveLength(1);
    expect(g.globals?.values[0].key).toBe('region');
    expect(parsed.skipped).toEqual([
      { file: 'Postman export/notes.json', reason: 'not valid JSON' },
      { file: 'Postman export/archive.json', reason: 'not a recognised file' },
    ]);
  });
});

describe('mergeWorkspace', () => {
  it('merge upserts by id and keeps existing data; replace drops it', () => {
    const existingCol = normalizeCollection({ info: { name: 'Keep me', _postman_id: 'keep', schema: 'x' }, item: [] });
    const current: WorkspaceData = { collections: [existingCol, { ...data.collections[0], info: { ...data.collections[0].info, name: 'Old name' } }], environments: [{ id: 'e-old', name: 'Old', values: [] }], globals: { name: 'Globals', values: [{ key: 'region', value: 'us' }, { key: 'keep', value: '1' }] }, history: [], runs: [], activeEnvironmentId: 'e-old' };
    const g = parseImportZip(buildWorkspaceZip({ meta: meta('x', 'X'), data })).groups[0];
    const merged = mergeWorkspace(current, g, 'merge');
    expect(merged.collections.map((c) => c.info.name)).toEqual(['Keep me', 'Realistic API', 'Realistic API']);
    expect(merged.environments.map((e) => e.name)).toEqual(['Old', 'Staging']);
    expect(merged.globals.values).toEqual([{ key: 'region', value: 'eu', type: 'default', enabled: true }, { key: 'keep', value: '1' }]);
    expect(merged.summary.replaced).toBe(1);
    expect(merged.activeEnvironmentId).toBe(envFixture.id);
    const replaced = mergeWorkspace(current, g, 'replace');
    expect(replaced.collections.map((c) => c.info.name)).toEqual(['Realistic API', 'Realistic API']);
    expect(replaced.globals.values.map((v) => v.key)).toEqual(['region']);
  });

  it('appends curl requests to the workspace’s "Imported" collection', () => {
    const req = { method: 'GET', url: 'https://x' };
    const first = mergeWorkspace(emptyWorkspaceData(), { key: 'k', name: 'n', collections: [], environments: [], globals: null, history: [], runs: [], requests: [{ id: 'r1', name: 'one', request: req }] }, 'merge');
    expect(first.collections.map((c) => [c.info.name, c.item.map((i) => i.id)])).toEqual([['Imported', ['r1']]]);
    const second = mergeWorkspace(first, { key: 'k', name: 'n', collections: [], environments: [], globals: null, history: [], runs: [], requests: [{ id: 'r2', name: 'two', request: req }] }, 'merge');
    expect(second.collections.map((c) => [c.info.name, c.item.map((i) => i.id)])).toEqual([['Imported', ['r1', 'r2']]]);
  });
});
