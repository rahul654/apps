import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import realistic from '../postman/__fixtures__/realistic.postman_collection.json';
import envFixture from '../postman/__fixtures__/env.postman_environment.json';
import globalsFixture from '../postman/__fixtures__/globals.postman_globals.json';
import { normalizeCollection, normalizeEnvironment } from '../postman/normalize';
import { toCollectionFile } from '../postman/export';
import { validateCollection, validateEnvironment } from '../postman/validate';
import type { HistoryEntry } from '../../types';
import { buildWorkspaceZip, mergeWorkspace, parseWorkspaceZip, type WorkspaceExport } from './zip';

const history: HistoryEntry[] = [
  { id: 'h1', at: '2024-01-01T00:00:00.000Z', method: 'GET', url: 'https://a', status: 200, statusText: 'OK', ok: true, time: 5, size: 2, timings: { total: 5, source: 'wall-clock' }, via: 'direct', request: { headers: [], body: null }, response: { headers: [], bodyText: '{}', contentType: 'application/json', binary: false } },
];
const ws: WorkspaceExport = {
  collections: [normalizeCollection(realistic), normalizeCollection({ info: { name: 'Realistic API', schema: 'x' }, item: [] })],
  environments: [normalizeEnvironment(envFixture)],
  globals: normalizeEnvironment(globalsFixture, 'globals'),
  history,
  runs: [{ id: 'run-1', collectionId: 'c', collectionName: 'C', startedAt: 'a', finishedAt: 'b', iterations: 1, delayMs: 0, steps: [], totals: { requests: 0, passed: 0, failed: 0, errors: 0 }, stopped: 'completed', schemaVersion: 1 }],
  activeEnvironmentId: envFixture.id,
};

describe('workspace zip', () => {
  it('contains valid Postman files, a manifest, history and runs; duplicate names get suffixes', () => {
    const zip = buildWorkspaceZip(ws, new Date('2024-06-01T00:00:00Z'));
    const files = unzipSync(zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['collections/Realistic API (2).postman_collection.json', 'collections/Realistic API.postman_collection.json', 'environments/Staging.postman_environment.json', 'globals.json', 'history.json', 'manifest.json', 'runs/run-1.json']);
    const read = (n: string) => JSON.parse(strFromU8(files[n]));
    expect(validateCollection(read('collections/Realistic API.postman_collection.json'))).toEqual([]);
    expect(validateCollection(read('collections/Realistic API (2).postman_collection.json'))).toEqual([]);
    expect(validateEnvironment(read('environments/Staging.postman_environment.json'))).toEqual([]);
    const g = read('globals.json');
    expect(validateEnvironment(g)).toEqual([]);
    expect(g._postman_variable_scope).toBe('globals');
    expect(read('manifest.json')).toMatchObject({ app: 'apiclient', schemaVersion: 1, exportedAt: '2024-06-01T00:00:00.000Z', activeEnvironmentId: envFixture.id });
    expect(read('history.json').entries).toEqual(history);
  });

  it('round-trips: parse(build(ws)) equals ws', () => {
    const parsed = parseWorkspaceZip(buildWorkspaceZip(ws));
    expect(parsed.fromPostman).toBe(false);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.collections.map(toCollectionFile)).toEqual(ws.collections.map(toCollectionFile));
    expect(parsed.environments.map((e) => ({ id: e.id, name: e.name, values: e.values }))).toEqual(ws.environments.map((e) => ({ id: e.id, name: e.name, values: e.values })));
    expect(parsed.globals?.values).toEqual(ws.globals.values);
    expect(parsed.history).toEqual(history);
    expect(parsed.runs).toEqual(ws.runs);
    const merged = mergeWorkspace({ collections: [], environments: [], globals: { name: 'Globals', values: [] }, history: [], runs: [] }, parsed, 'replace');
    expect(merged.collections).toHaveLength(2);
    expect(merged.activeEnvironmentId).toBe(envFixture.id);
    expect(merged.summary).toEqual({ collections: 2, environments: 1, globals: 1, history: 1, runs: 1, replaced: 0 });
  });

  it('merge upserts by id and keeps existing data; replace drops it', () => {
    const existingCol = normalizeCollection({ info: { name: 'Keep me', _postman_id: 'keep', schema: 'x' }, item: [] });
    const current: WorkspaceExport = { collections: [existingCol, { ...ws.collections[0], info: { ...ws.collections[0].info, name: 'Old name' } }], environments: [{ id: 'e-old', name: 'Old', values: [] }], globals: { name: 'Globals', values: [{ key: 'region', value: 'us' }, { key: 'keep', value: '1' }] }, history: [], runs: [], activeEnvironmentId: 'e-old' };
    const parsed = parseWorkspaceZip(buildWorkspaceZip(ws));
    const merged = mergeWorkspace(current, parsed, 'merge');
    expect(merged.collections.map((c) => c.info.name)).toEqual(['Keep me', 'Realistic API', 'Realistic API']);
    expect(merged.environments.map((e) => e.name)).toEqual(['Old', 'Staging']);
    expect(merged.globals.values).toEqual([{ key: 'region', value: 'eu', type: 'default', enabled: true }, { key: 'keep', value: '1' }]);
    expect(merged.summary.replaced).toBe(1);
    expect(merged.activeEnvironmentId).toBe(envFixture.id);
    const replaced = mergeWorkspace(current, parsed, 'replace');
    expect(replaced.collections.map((c) => c.info.name)).toEqual(['Realistic API', 'Realistic API']);
    expect(replaced.globals.values.map((v) => v.key)).toEqual(['region']);
  });

  it('reads a Postman-style export zip (files anywhere, detected by content) and reports skipped files', () => {
    const zip = zipSync({
      'Postman export/collection/My.postman_collection.json': strToU8(JSON.stringify(realistic)),
      'Postman export/environment/E.postman_environment.json': strToU8(JSON.stringify(envFixture)),
      'Postman export/globals/G.postman_globals.json': strToU8(JSON.stringify(globalsFixture)),
      'Postman export/archive.json': strToU8(JSON.stringify({ collection: {}, environment: {} })),
      'Postman export/notes.json': strToU8('not json'),
      'Postman export/readme.txt': strToU8('hi'),
    });
    const parsed = parseWorkspaceZip(zip);
    expect(parsed.fromPostman).toBe(true);
    expect(parsed.collections).toHaveLength(1);
    expect(parsed.environments).toHaveLength(1);
    expect(parsed.globals?.values[0].key).toBe('region');
    expect(parsed.skipped).toEqual([
      { file: 'Postman export/archive.json', reason: 'not a recognised file' },
      { file: 'Postman export/notes.json', reason: 'not valid JSON' },
    ]);
  });
});
