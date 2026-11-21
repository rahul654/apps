import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import realistic from '../postman/__fixtures__/realistic.postman_collection.json';
import { normalizeCollection } from '../postman/normalize';
import type { PmEnvironmentFile } from '../postman/types';
import { DEFAULT_WORKSPACE_ID, emptyWorkspaceData, type WorkspaceData, type WorkspaceMeta } from '../workspaces';
import { planImport, strategiesFor } from './importPlan';
import { buildAllWorkspacesZip, parseImportZip } from './zip';

const meta = (id: string, name: string): WorkspaceMeta => ({ id, name, ...(id === DEFAULT_WORKSPACE_ID ? { isDefault: true } : {}), createdAt: id === DEFAULT_WORKSPACE_ID ? '1' : '2', updatedAt: '2' });
const env = (id: string, name: string, value = name): PmEnvironmentFile => ({ id, name, values: [{ key: 'k', value }], _postman_variable_scope: 'environment' });
const col = (id: string, name: string) => normalizeCollection({ info: { _postman_id: id, name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] });

/** A zip in the layout scripts/export-from-postman.mjs writes. */
function scriptZip(): Uint8Array {
  const j = (v: unknown) => strToU8(JSON.stringify(v));
  const pmEnv = (id: string, name: string) => ({ id, name, values: [{ key: 'host', value: name, type: 'default', enabled: true }], _postman_variable_scope: 'environment', _postman_exported_at: 'x', _postman_exported_using: 'apiclient/export-from-postman' });
  return zipSync({
    'collections/Team Workspace/Orders API.postman_collection.json': j({ ...realistic, info: { ...realistic.info, _postman_id: 'orders', name: 'Orders API' } }),
    'collections/Team Workspace/Users.postman_collection.json': j({ info: { _postman_id: 'users', name: 'Users', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] }),
    'environments/Team Workspace/orders-uat.postman_environment.json': j(pmEnv('env-uat', 'orders-uat')),
    'collections/My Workspace/Scratch.postman_collection.json': j({ info: { _postman_id: 'scratch', name: 'Scratch', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] }),
    'environments/My Workspace/local.postman_environment.json': j(pmEnv('env-local', 'local')),
    'globals/Team Workspace.postman_globals.json': j({ id: 'globals-w1', name: 'Team Workspace globals', values: [{ key: 'team', value: '1', type: 'default', enabled: true }], _postman_variable_scope: 'globals' }),
    'globals/My Workspace.postman_globals.json': j({ id: 'globals-w2', name: 'My Workspace globals', values: [{ key: 'mine', value: '2', type: 'default', enabled: true }], _postman_variable_scope: 'globals' }),
    'manifest.json': j({
      app: 'apiclient',
      source: 'postman-api',
      exportedAt: 'x',
      workspaces: [
        { id: 'w1', name: 'Team Workspace', type: 'team', collections: [{ uid: '1-orders', name: 'Orders API', file: 'collections/Team Workspace/Orders API.postman_collection.json' }, { uid: '1-users', name: 'Users', file: 'collections/Team Workspace/Users.postman_collection.json' }], environments: [{ uid: '1-env-uat', name: 'orders-uat', file: 'environments/Team Workspace/orders-uat.postman_environment.json' }], globals: 1 },
        { id: 'w2', name: 'My Workspace', type: 'personal', collections: [{ uid: '1-scratch', name: 'Scratch', file: 'collections/My Workspace/Scratch.postman_collection.json' }], environments: [{ uid: '1-env-local', name: 'local', file: 'environments/My Workspace/local.postman_environment.json' }], globals: 1 },
      ],
      skipped: [],
      warnings: [],
      maskedSecrets: [],
    }),
  });
}

const baseApp = () => {
  const a: WorkspaceData = { ...emptyWorkspaceData(), environments: [env('a1', 'A env')], collections: [col('ca', 'A col')], activeEnvironmentId: 'a1' };
  const b: WorkspaceData = { ...emptyWorkspaceData(), environments: [env('b1', 'B env')], collections: [col('cb', 'B col')], activeEnvironmentId: 'b1' };
  return { workspaces: [meta(DEFAULT_WORKSPACE_ID, 'Default'), meta('a', 'A'), meta('b', 'B'), meta('mine', 'my workspace')], data: { [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData(), a, b, mine: { ...emptyWorkspaceData(), collections: [col('keep', 'Keep')] } } };
};

describe('script zips (export-from-postman.mjs)', () => {
  const parsed = parseImportZip(scriptZip(), 'postman-export-acme.zip');

  it('are recognised with one group per Postman workspace, globals routed by id', () => {
    expect(parsed.kind).toBe('postman-api');
    expect(strategiesFor(parsed)).toEqual(['target', 'per-postman']);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.groups.map((g) => [g.name, g.collections.map((c) => c.info.name).sort(), g.environments.map((e) => e.name), g.globals?.values.map((v) => v.key)])).toEqual([
      ['Team Workspace', ['Orders API', 'Users'], ['orders-uat'], ['team']],
      ['My Workspace', ['Scratch'], ['local'], ['mine']],
    ]);
  });

  it('"one workspace per Postman workspace" creates missing ones and merges into same-named ones (ignoring case)', () => {
    const app = baseApp();
    let n = 0;
    const ops = planImport(app, parsed, { strategy: 'per-postman', mode: 'merge', target: { kind: 'existing', id: DEFAULT_WORKSPACE_ID }, newId: () => `new-${++n}`, now: 'now' });
    expect(ops.map((o) => [o.ws, o.name, !!o.create])).toEqual([['new-1', 'Team Workspace', true], ['mine', 'my workspace', false]]);
    expect(ops[0].data.collections.map((c) => c.info.name).sort()).toEqual(['Orders API', 'Users']);
    expect(ops[0].data.globals.values.map((v) => v.key)).toEqual(['team']);
    expect(ops[1].data.collections.map((c) => c.info.name)).toEqual(['Keep', 'Scratch']);
    expect(ops[1].data.globals.values.map((v) => v.key)).toEqual(['mine']);
  });

  it('"everything into one workspace" flattens into the chosen target only', () => {
    const app = baseApp();
    const ops = planImport(app, parsed, { strategy: 'target', mode: 'merge', target: { kind: 'existing', id: DEFAULT_WORKSPACE_ID } });
    expect(ops).toHaveLength(1);
    expect(ops[0].ws).toBe(DEFAULT_WORKSPACE_ID);
    expect(ops[0].data.collections).toHaveLength(3);
    expect(ops[0].data.environments).toHaveLength(2);
    expect(ops[0].data.globals.values.map((v) => v.key)).toEqual(['team', 'mine']);
  });

  it('a new target workspace gets the typed name, made unique', () => {
    const app = baseApp();
    const [op] = planImport(app, parsed, { strategy: 'target', mode: 'merge', target: { kind: 'new', name: 'a' }, newId: () => 'n1', now: 'now' });
    expect(op.create).toEqual({ id: 'n1', name: 'a (2)', createdAt: 'now', updatedAt: 'now' });
  });
});

describe('isolation', () => {
  it('Replace into A leaves B (and every other workspace) intact', () => {
    const app = baseApp();
    const parsed = parseImportZip(scriptZip());
    const ops = planImport(app, parsed, { strategy: 'target', mode: 'replace', target: { kind: 'existing', id: 'a' } });
    expect(ops.map((o) => o.ws)).toEqual(['a']);
    expect(ops[0].data.collections.map((c) => c.info.name)).not.toContain('A col');
    expect(ops[0].data.environments.map((e) => e.name)).not.toContain('A env');
    expect(ops[0].data.activeEnvironmentId).toBeNull();
    expect(app.data.b.collections.map((c) => c.info.name)).toEqual(['B col']); // input untouched
  });

  it('an unknown target id falls back to Default', () => {
    const [op] = planImport(baseApp(), parseImportZip(scriptZip()), { strategy: 'target', mode: 'merge', target: { kind: 'existing', id: 'deleted' } });
    expect(op.ws).toBe(DEFAULT_WORKSPACE_ID);
  });
});

describe('restore (all-workspaces zips)', () => {
  it('restores by id: Default to Default, existing ones merged or replaced and renamed, missing ones created; flatten goes to one target', () => {
    const backup = buildAllWorkspacesZip([
      { meta: { ...meta(DEFAULT_WORKSPACE_ID, 'Main'), isDefault: true }, data: { ...emptyWorkspaceData(), collections: [col('d1', 'D1')] } },
      { meta: meta('a', 'Alpha'), data: { ...emptyWorkspaceData(), environments: [env('a2', 'A2')], activeEnvironmentId: 'a2' } },
      { meta: meta('z', 'B'), data: { ...emptyWorkspaceData(), collections: [col('z1', 'Z1')] } }, // name clashes with existing "B"
    ]);
    const parsed = parseImportZip(backup);
    expect(strategiesFor(parsed)).toEqual(['restore', 'target']);
    const app = baseApp();
    const merged = planImport(app, parsed, { strategy: 'restore', mode: 'merge', target: { kind: 'existing', id: DEFAULT_WORKSPACE_ID }, now: 'now' });
    expect(merged.map((o) => [o.ws, o.name, o.rename ?? null, !!o.create])).toEqual([[DEFAULT_WORKSPACE_ID, 'Main', 'Main', false], ['a', 'Alpha', 'Alpha', false], ['z', 'B (2)', null, true]]);
    expect(merged[1].data.environments.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(merged[1].data.activeEnvironmentId).toBe('a2');
    const replaced = planImport(app, parsed, { strategy: 'restore', mode: 'replace', target: { kind: 'existing', id: DEFAULT_WORKSPACE_ID } });
    expect(replaced[1].data.environments.map((e) => e.id)).toEqual(['a2']);
    expect(replaced.map((o) => o.ws)).not.toContain('b');
    const flat = planImport(app, parsed, { strategy: 'target', mode: 'merge', target: { kind: 'existing', id: 'b' } });
    expect(flat.map((o) => o.ws)).toEqual(['b']);
    expect(flat[0].data.collections.map((c) => c.info.name)).toEqual(['B col', 'D1', 'Z1']);
  });
});
