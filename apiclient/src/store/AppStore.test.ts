import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openStore } from '../lib/db';
import { DEFAULT_PREFS } from '../lib/prefs';
import { DEFAULT_WORKSPACE_ID, emptyWorkspaceData } from '../lib/workspaces';
import type { HistoryEntry } from '../types';
import { variableWriteAction } from './variableWrite';
import { loadAll, newEnvironment, newWorkspaceMeta, persist, reducer, stateFromInitial, viewOf, type Action, type AppState } from './AppStore';

const hist = (id: string): HistoryEntry => ({ id, at: `2024-01-01T00:00:0${id.length}.000Z`, method: 'GET', url: 'https://a', status: 200, statusText: 'OK', ok: true, time: 1, size: 1, timings: { total: 1, source: 'wall-clock' }, via: 'direct', request: { headers: [], body: null }, response: { headers: [], bodyText: '', contentType: '', binary: false } });

/** Applies actions like the provider does: the active workspace is filled in for data actions. */
function run(s: AppState, ...actions: Action[]): AppState {
  for (const a of actions) s = reducer(s, a);
  return s;
}
const fresh = () => stateFromInitial({});
const wsA = newWorkspaceMeta('A', '2024-01-02T00:00:00.000Z');
const wsB = newWorkspaceMeta('B', '2024-01-03T00:00:00.000Z');

describe('workspace CRUD', () => {
  it('creates, renames (unique, ignoring case), switches and deletes; Default is first and protected', () => {
    let s = run(fresh(), { type: 'workspace/create', meta: wsB }, { type: 'workspace/create', meta: wsA, activate: true });
    expect(s.workspaces.map((w) => w.name)).toEqual(['Default', 'A', 'B']);
    expect(viewOf(s).workspace.name).toBe('A');
    s = run(s, { type: 'workspace/rename', id: wsA.id, name: '  b ' });
    expect(s.workspaces.find((w) => w.id === wsA.id)!.name).toBe('b (2)');
    s = run(s, { type: 'workspace/rename', id: wsA.id, name: '   ' });
    expect(s.workspaces.find((w) => w.id === wsA.id)!.name).toBe('b (2)');
    s = run(s, { type: 'workspace/rename', id: DEFAULT_WORKSPACE_ID, name: 'Main' });
    expect(s.workspaces[0]).toMatchObject({ id: DEFAULT_WORKSPACE_ID, name: 'Main', isDefault: true });
    expect(run(s, { type: 'workspace/remove', id: DEFAULT_WORKSPACE_ID })).toBe(s);
    s = run(s, { type: 'workspace/remove', id: wsA.id });
    expect(s.workspaces.map((w) => w.id)).toEqual([DEFAULT_WORKSPACE_ID, wsB.id]);
    expect(s.data[wsA.id]).toBeUndefined();
    expect(s.prefs.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID); // deleting the active one falls back to Default
    expect(run(s, { type: 'workspace/switch', id: 'nope' })).toBe(s);
    expect(run(s, { type: 'workspace/switch', id: wsB.id }).prefs.activeWorkspaceId).toBe(wsB.id);
  });

  it('undo after delete restores the workspace with its data', () => {
    const e = newEnvironment('kept');
    const s0 = run(fresh(), { type: 'workspace/create', meta: wsA, activate: true }, { type: 'environment/put', env: e });
    const data = s0.data[wsA.id];
    const deleted = run(s0, { type: 'workspace/remove', id: wsA.id });
    const restored = run(deleted, { type: 'workspace/create', meta: wsA, data, activate: true });
    expect(viewOf(restored).environments).toEqual([e]);
    expect(viewOf(restored).workspace.id).toBe(wsA.id);
  });

  it('prefs/set never changes the active workspace; wipe leaves only an empty Default', () => {
    let s = run(fresh(), { type: 'workspace/create', meta: wsA, activate: true });
    s = run(s, { type: 'prefs/set', prefs: { ...DEFAULT_PREFS, mode: 'proxy' } });
    expect(s.prefs).toMatchObject({ mode: 'proxy', activeWorkspaceId: wsA.id });
    s = run(s, { type: 'wipe' });
    expect(s.workspaces.map((w) => w.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(s.data).toEqual({ [DEFAULT_WORKSPACE_ID]: emptyWorkspaceData() });
    expect(s.prefs).toMatchObject({ mode: 'proxy', activeWorkspaceId: DEFAULT_WORKSPACE_ID });
  });
});

describe('isolation', () => {
  it('environments, globals and the active environment set in A are not visible in B', () => {
    const e = newEnvironment('only in A');
    let s = run(fresh(), { type: 'workspace/create', meta: wsA, activate: true }, { type: 'workspace/create', meta: wsB });
    s = run(s, { type: 'environment/put', env: e }, { type: 'environment/active', id: e.id! }, { type: 'globals/set', globals: { name: 'Globals', values: [{ key: 'g', value: 'a' }] } });
    expect(viewOf(s).environments.map((x) => x.name)).toEqual(['only in A']);
    s = run(s, { type: 'workspace/switch', id: wsB.id });
    const b = viewOf(s);
    expect(b.environments).toEqual([]);
    expect(b.activeEnvironmentId).toBeNull();
    expect(b.globals.values).toEqual([]);
    s = run(s, { type: 'workspace/switch', id: wsA.id });
    expect(viewOf(s).activeEnvironmentId).toBe(e.id);
  });

  it('a data action tagged with a workspace lands there even when another is active; deleted workspaces are ignored', () => {
    let s = run(fresh(), { type: 'workspace/create', meta: wsA }, { type: 'workspace/create', meta: wsB, activate: true });
    s = run(s, { type: 'history/add', entry: hist('h1'), ws: wsA.id }, { type: 'history/add', entry: hist('h22') });
    expect(s.data[wsA.id].history.map((h) => h.id)).toEqual(['h1']);
    expect(viewOf(s).history.map((h) => h.id)).toEqual(['h22']);
    expect(run(s, { type: 'history/add', entry: hist('x'), ws: 'deleted' })).toBe(s);
    s = run(s, { type: 'history/clear' });
    expect(s.data[wsA.id].history).toHaveLength(1);
  });

  it('the history limit applies per workspace', () => {
    let s = run(stateFromInitial({ prefs: { historyLimit: 2 } }), { type: 'workspace/create', meta: wsA });
    s = run(s, { type: 'history/add', entry: hist('1') }, { type: 'history/add', entry: hist('22') }, { type: 'history/add', entry: hist('333') }, { type: 'history/add', entry: hist('a'), ws: wsA.id });
    expect(viewOf(s).history.map((h) => h.id)).toEqual(['333', '22']);
    expect(s.data[wsA.id].history.map((h) => h.id)).toEqual(['a']);
  });
});

describe('persistence', () => {
  it('writes each workspace separately and loads them back', async () => {
    const store = await openStore(new IDBFactory(), 'persist');
    let s: AppState = { ...stateFromInitial({}), data: (await loadAll(store, DEFAULT_PREFS)).data };
    const apply = async (a: Action) => {
      const prev = s;
      s = reducer(s, a);
      await persist(store, a, prev, s);
    };
    const eA = newEnvironment('A env');
    const eD = newEnvironment('Default env');
    await apply({ type: 'environment/put', env: eD, ws: DEFAULT_WORKSPACE_ID });
    await apply({ type: 'workspace/create', meta: wsA, activate: true });
    await apply({ type: 'environment/put', env: eA, ws: wsA.id });
    await apply({ type: 'environment/active', id: eA.id!, ws: wsA.id });
    await apply({ type: 'globals/set', globals: { name: 'Globals', values: [{ key: 'g', value: 'A' }] }, ws: wsA.id });
    await apply({ type: 'history/add', entry: hist('h1'), ws: wsA.id });
    await apply({ type: 'workspace/rename', id: DEFAULT_WORKSPACE_ID, name: 'Main' });
    await apply({ type: 'workspace/create', meta: wsB });
    await apply({ type: 'history/add', entry: hist('h1'), ws: wsB.id }); // same id, other workspace
    await apply({ type: 'workspace/remove', id: wsB.id });

    const loaded = await loadAll(store, DEFAULT_PREFS);
    expect(loaded.workspaces.map((w) => w.name)).toEqual(['Main', 'A']);
    expect(loaded.data[DEFAULT_WORKSPACE_ID].environments.map((e) => e.name)).toEqual(['Default env']);
    expect(loaded.data[DEFAULT_WORKSPACE_ID].activeEnvironmentId).toBeNull();
    expect(loaded.data[wsA.id].environments.map((e) => e.name)).toEqual(['A env']);
    expect(loaded.data[wsA.id].activeEnvironmentId).toBe(eA.id);
    expect(loaded.data[wsA.id].globals.values).toEqual([{ key: 'g', value: 'A' }]);
    expect(loaded.data[wsA.id].history.map((h) => h.id)).toEqual(['h1']);
    expect(loaded.data[wsB.id]).toBeUndefined();

    await apply({ type: 'wipe' });
    const wiped = await loadAll(store, DEFAULT_PREFS);
    expect(wiped.workspaces.map((w) => w.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(wiped.data[DEFAULT_WORKSPACE_ID]).toEqual(emptyWorkspaceData());
    store.close();
  });
});

describe('tab session', () => {
  it('tabs/set is per workspace, persisted, loaded back, and removed with the workspace or a wipe', async () => {
    const store = await openStore(new IDBFactory(), 'tabs');
    let s: AppState = { ...stateFromInitial({}), data: (await loadAll(store, DEFAULT_PREFS)).data };
    const apply = async (a: Action) => {
      const prev = s;
      s = reducer(s, a);
      await persist(store, a, prev, s);
    };
    await apply({ type: 'workspace/create', meta: wsA });
    await apply({ type: 'tabs/set', ws: DEFAULT_WORKSPACE_ID, tabs: { tabs: [{ id: 'r:c:1' }, { id: 'r:c:2', preview: true }], activeId: 'r:c:2' } });
    await apply({ type: 'tabs/set', ws: wsA.id, tabs: { tabs: [{ id: 'n:x' }], activeId: 'n:x' } });
    expect(viewOf(s).tabs.activeId).toBe('r:c:2');
    expect(run(s, { type: 'tabs/set', ws: 'deleted', tabs: { tabs: [], activeId: null } })).toBe(s);
    const loaded = await loadAll(store, DEFAULT_PREFS);
    expect(loaded.session[DEFAULT_WORKSPACE_ID]).toEqual({ tabs: [{ id: 'r:c:1' }, { id: 'r:c:2', preview: true }], activeId: 'r:c:2' });
    expect(loaded.session[wsA.id].activeId).toBe('n:x');
    await apply({ type: 'workspace/remove', id: wsA.id });
    expect(s.session[wsA.id]).toBeUndefined();
    expect((await loadAll(store, DEFAULT_PREFS)).session[wsA.id]).toBeUndefined();
    await apply({ type: 'wipe' });
    expect(s.session).toEqual({});
    expect((await loadAll(store, DEFAULT_PREFS)).session).toEqual({});
    store.close();
  });
});

describe('variable write-back', () => {
  const env1 = { ...newEnvironment('Staging'), values: [{ key: 'url', value: 'https://old', type: 'default', enabled: true }] };
  const col = { info: { _postman_id: 'c1', name: 'API', schema: '' }, item: [{ id: 'f1', name: 'Auth', item: [], variable: [{ key: 'fv', value: '1' }] }], variable: [{ key: 'cv', value: 'a' }] };
  const base = () => stateFromInitial({ environments: [env1], activeEnvironmentId: env1.id!, collections: [col], globals: { id: 'globals', name: 'Globals', values: [] } });
  const write = (s: AppState, target: Parameters<typeof variableWriteAction>[1], key: string, value: string) => {
    const a = variableWriteAction(viewOf(s), target, key, value);
    expect(a).not.toBeNull();
    return reducer(s, a!);
  };

  it('writes to the environment, collection, folder and globals', () => {
    let s = write(base(), { kind: 'environment', id: env1.id! }, 'url', 'https://new');
    expect(viewOf(s).environments[0].values).toEqual([{ key: 'url', value: 'https://new', type: 'default', enabled: true }]);
    s = write(s, { kind: 'environment', id: env1.id! }, 'added', 'x');
    expect(viewOf(s).environments[0].values.map((v) => v.key)).toEqual(['url', 'added']);
    s = write(s, { kind: 'collection', cid: 'c1' }, 'cv', 'b');
    expect(viewOf(s).collections[0].variable).toEqual([{ key: 'cv', value: 'b' }]);
    s = write(s, { kind: 'folder', cid: 'c1', id: 'f1' }, 'fv', '2');
    expect((viewOf(s).collections[0].item[0] as { variable: unknown }).variable).toEqual([{ key: 'fv', value: '2' }]);
    s = write(s, { kind: 'globals' }, 'region', 'eu');
    expect(viewOf(s).globals.values).toEqual([{ key: 'region', value: 'eu', type: 'default', enabled: true }]);
    expect(variableWriteAction(viewOf(s), { kind: 'environment', id: 'gone' }, 'k', 'v')).toBeNull();
    expect(variableWriteAction(viewOf(s), { kind: 'request' }, 'k', 'v')).toBeNull();
  });
});
