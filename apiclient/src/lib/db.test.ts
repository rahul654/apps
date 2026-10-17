import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_VERSION, openStore, request, STORES, transactionDone, wsRange, type WorkspaceRecord, type WsRow } from './db';
import { loadAll } from '../store/AppStore';
import { DEFAULT_PREFS } from './prefs';
import { DEFAULT_WORKSPACE_ID, emptyWorkspaceData } from './workspaces';

/** Opens a database exactly as the version-1 app did (single data set, globals and active env in kv). */
function openV1(idb: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('collections', { keyPath: 'id' });
      db.createObjectStore('environments', { keyPath: 'id' });
      const h = db.createObjectStore('history', { keyPath: 'id' });
      h.createIndex('at', 'at');
      db.createObjectStore('runs', { keyPath: 'id' });
      db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const col = (id: string, name: string) => ({ info: { _postman_id: id, name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] });
const env = (id: string, name: string) => ({ id, name, values: [{ key: 'k', value: name, type: 'default', enabled: true }], _postman_variable_scope: 'environment' });
const hist = (id: string, at: string) => ({ id, at, method: 'GET', url: `https://x/${id}`, status: 200, statusText: 'OK', ok: true, time: 1, size: 1, timings: { total: 1, source: 'wall-clock' }, via: 'direct', request: { headers: [], body: null }, response: { headers: [], bodyText: '', contentType: '', binary: false } });
const run = (id: string, startedAt: string) => ({ id, collectionId: 'c1', collectionName: 'C', startedAt, finishedAt: startedAt, iterations: 1, delayMs: 0, steps: [], totals: { requests: 0, passed: 0, failed: 0, errors: 0 }, stopped: 'completed', schemaVersion: 1 });

/** Writes the rows the version-1 app wrote: 45 collections, 26 environments, history, runs, globals, active env. */
async function seedV1(db: IDBDatabase, activeEnvironmentId: string) {
  const tx = db.transaction(['collections', 'environments', 'history', 'runs', 'kv'], 'readwrite');
  for (let i = 0; i < 45; i++) tx.objectStore('collections').put({ id: `c${i}`, data: col(`c${i}`, `Collection ${i}`), updatedAt: `2024-01-01T00:00:${String(i).padStart(2, '0')}.000Z` });
  for (let i = 0; i < 26; i++) tx.objectStore('environments').put(env(`e${i}`, `Env ${String(i).padStart(2, '0')}`));
  for (let i = 0; i < 30; i++) tx.objectStore('history').put(hist(`h${i}`, `2024-02-01T00:00:${String(i).padStart(2, '0')}.000Z`));
  tx.objectStore('runs').put(run('run-1', '2024-03-01T00:00:00.000Z'));
  tx.objectStore('runs').put(run('run-2', '2024-03-02T00:00:00.000Z'));
  tx.objectStore('kv').put({ key: 'globals', value: { id: 'globals', name: 'Globals', values: [{ key: 'region', value: 'eu' }], _postman_variable_scope: 'globals' } });
  tx.objectStore('kv').put({ key: 'activeEnvironmentId', value: activeEnvironmentId });
  await transactionDone(tx);
}

describe('IndexedDB store', () => {
  it('creates the v2 stores, round-trips workspace rows and clears everything', async () => {
    const store = await openStore(new IDBFactory(), 'apiclient-test');
    await store.put(STORES.collections, { ws: 'a', id: 'c1', data: { info: { name: 'x' } }, updatedAt: 'now' });
    await store.put(STORES.collections, { ws: 'b', id: 'c1', data: { info: { name: 'same id, other workspace' } }, updatedAt: 'now' });
    await store.putMany(STORES.history, [{ ws: 'a', id: 'h1', data: { at: '1' } }, { ws: 'a', id: 'h2', data: { at: '2' } }, { ws: 'b', id: 'h1', data: { at: '3' } }]);
    await store.kvSet('x', { values: [] });
    expect((await store.getAll(STORES.collections)).length).toBe(2);
    expect((await store.getAll(STORES.collections, wsRange('a'))).length).toBe(1);
    expect(await store.get(STORES.history, ['a', 'h2'])).toEqual({ ws: 'a', id: 'h2', data: { at: '2' } });
    expect(await store.kvGet('x')).toEqual({ values: [] });
    await store.delete(STORES.history, wsRange('a'));
    expect(await store.getAll<WsRow<unknown>>(STORES.history)).toEqual([{ ws: 'b', id: 'h1', data: { at: '3' } }]);
    await store.clearAll();
    expect((await store.getAll(STORES.history)).length).toBe(0);
    expect(await store.kvGet('x')).toBeUndefined();
    store.close();
  });

  it('replaceWorkspace and deleteWorkspace only touch that workspace', async () => {
    const store = await openStore(new IDBFactory(), 'apiclient-test');
    const rec = (id: string): WorkspaceRecord => ({ id, name: id, createdAt: 'x', updatedAt: 'x', globals: emptyWorkspaceData().globals, activeEnvironmentId: null });
    await store.replaceWorkspace(rec('a'), { ...emptyWorkspaceData(), collections: [col('c1', 'A1') as never, col('c2', 'A2') as never] });
    await store.replaceWorkspace(rec('b'), { ...emptyWorkspaceData(), collections: [col('c1', 'B1') as never] });
    await store.replaceWorkspace(rec('a'), { ...emptyWorkspaceData(), collections: [col('c3', 'A3') as never] });
    const names = async () => (await store.getAll<WsRow<{ info: { name: string } }>>(STORES.collections)).map((r) => `${r.ws}:${r.data.info.name}`).sort();
    expect(await names()).toEqual(['a:A3', 'b:B1']);
    await store.deleteWorkspace('a');
    expect(await names()).toEqual(['b:B1']);
    expect((await store.getAll<WorkspaceRecord>(STORES.workspaces)).map((w) => w.id)).toEqual(['b']);
    store.close();
  });

  it('a fresh database gets a Default workspace on first load', async () => {
    const store = await openStore(new IDBFactory(), 'fresh');
    const loaded = await loadAll(store, DEFAULT_PREFS);
    expect(loaded.workspaces.map((w) => [w.id, w.name, w.isDefault])).toEqual([[DEFAULT_WORKSPACE_ID, 'Default', true]]);
    expect((await store.getAll<WorkspaceRecord>(STORES.workspaces)).length).toBe(1);
    store.close();
  });
});

describe('migration from version 1', () => {
  it('moves every collection, environment, history entry, run, the globals and the active environment into Default', async () => {
    const idb = new IDBFactory();
    const v1 = await openV1(idb, 'apiclient');
    await seedV1(v1, 'e7');
    v1.close();

    const store = await openStore(idb, 'apiclient');
    const loaded = await loadAll(store, DEFAULT_PREFS);
    expect(loaded.workspaces).toHaveLength(1);
    expect(loaded.workspaces[0]).toMatchObject({ id: DEFAULT_WORKSPACE_ID, name: 'Default', isDefault: true });
    const d = loaded.data[DEFAULT_WORKSPACE_ID];
    expect(d.collections).toHaveLength(45);
    expect(d.collections[0].info.name).toBe('Collection 0'); // order by updatedAt is kept
    expect(d.collections[44].info.name).toBe('Collection 44');
    expect(d.environments).toHaveLength(26);
    expect(d.environments[3]).toEqual(env('e3', 'Env 03'));
    expect(d.history).toHaveLength(30);
    expect(d.history[0].id).toBe('h29');
    expect(d.runs.map((r) => r.id)).toEqual(['run-2', 'run-1']);
    expect(d.globals.values).toEqual([{ key: 'region', value: 'eu' }]);
    expect(d.activeEnvironmentId).toBe('e7');
    // The old kv keys are gone; rows are keyed [ws, id].
    expect(await store.kvGet('globals')).toBeUndefined();
    expect(await store.kvGet('activeEnvironmentId')).toBeUndefined();
    expect(await store.get(STORES.environments, [DEFAULT_WORKSPACE_ID, 'e7'])).toMatchObject({ ws: DEFAULT_WORKSPACE_ID, id: 'e7', data: { name: 'Env 07' } });
    store.close();

    // Opening again is a no-op (already the current version).
    const again = await openStore(idb, 'apiclient');
    expect((await loadAll(again, DEFAULT_PREFS)).data[DEFAULT_WORKSPACE_ID].collections).toHaveLength(45);
    again.close();
    const raw = await new Promise<IDBDatabase>((res, rej) => {
      const r = idb.open('apiclient');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect(raw.version).toBe(DB_VERSION);
    expect([...raw.objectStoreNames].sort()).toEqual(['collections', 'drafts', 'environments', 'history', 'kv', 'runs', 'tabs', 'workspaces']);
    expect(await request(raw.transaction('workspaces').objectStore('workspaces').count())).toBe(1);
    raw.close();
  });

  it('an active environment that no longer exists becomes none; an empty v1 database migrates too', async () => {
    const idb = new IDBFactory();
    const v1 = await openV1(idb, 'apiclient');
    await seedV1(v1, 'gone');
    v1.close();
    const store = await openStore(idb, 'apiclient');
    expect((await loadAll(store, DEFAULT_PREFS)).data[DEFAULT_WORKSPACE_ID].activeEnvironmentId).toBeNull();
    store.close();

    const idb2 = new IDBFactory();
    (await openV1(idb2, 'apiclient')).close();
    const s2 = await openStore(idb2, 'apiclient');
    const l2 = await loadAll(s2, DEFAULT_PREFS);
    expect(l2.workspaces.map((w) => w.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(l2.data[DEFAULT_WORKSPACE_ID]).toEqual(emptyWorkspaceData());
    s2.close();
  });
});

/** Opens a database exactly as the version-2 app created it (multiple workspaces, no tab session). */
function openV2(idb: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv', { keyPath: 'key' });
      db.createObjectStore('workspaces', { keyPath: 'id' });
      for (const n of ['collections', 'environments', 'history', 'runs']) db.createObjectStore(n, { keyPath: ['ws', 'id'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Writes the rows the version-2 app wrote: Default with 45 collections and 26 environments, plus a second workspace. */
async function seedV2(db: IDBDatabase) {
  const tx = db.transaction(['workspaces', 'collections', 'environments', 'history', 'runs'], 'readwrite');
  const rec = (id: string, name: string, extra: object) => ({ id, name, createdAt: `2024-01-0${id === DEFAULT_WORKSPACE_ID ? 1 : 2}T00:00:00.000Z`, updatedAt: '2024-01-03T00:00:00.000Z', globals: { id: 'globals', name: 'Globals', values: [{ key: 'g', value: name }], _postman_variable_scope: 'globals' }, activeEnvironmentId: null, ...extra });
  tx.objectStore('workspaces').put(rec(DEFAULT_WORKSPACE_ID, 'Default', { isDefault: true, activeEnvironmentId: 'e3' }));
  tx.objectStore('workspaces').put(rec('ws-b', 'Team', {}));
  for (let i = 0; i < 45; i++) tx.objectStore('collections').put({ ws: DEFAULT_WORKSPACE_ID, id: `c${i}`, data: col(`c${i}`, `Collection ${i}`), updatedAt: `2024-01-01T00:00:${String(i).padStart(2, '0')}.000Z` });
  for (let i = 0; i < 26; i++) tx.objectStore('environments').put({ ws: DEFAULT_WORKSPACE_ID, id: `e${i}`, data: env(`e${i}`, `Env ${String(i).padStart(2, '0')}`) });
  tx.objectStore('collections').put({ ws: 'ws-b', id: 'c0', data: col('c0', 'Same id in Team'), updatedAt: '2024-01-05T00:00:00.000Z' });
  for (let i = 0; i < 5; i++) tx.objectStore('history').put({ ws: DEFAULT_WORKSPACE_ID, id: `h${i}`, data: hist(`h${i}`, `2024-02-01T00:00:0${i}.000Z`) });
  tx.objectStore('runs').put({ ws: 'ws-b', id: 'run-1', data: run('run-1', '2024-03-01T00:00:00.000Z') });
  await transactionDone(tx);
}

describe('migration from version 2', () => {
  it('keeps every workspace row and adds empty tab and draft stores', async () => {
    const idb = new IDBFactory();
    const v2 = await openV2(idb, 'apiclient');
    await seedV2(v2);
    v2.close();

    const store = await openStore(idb, 'apiclient');
    const loaded = await loadAll(store, DEFAULT_PREFS);
    expect(loaded.workspaces.map((w) => [w.id, w.name])).toEqual([[DEFAULT_WORKSPACE_ID, 'Default'], ['ws-b', 'Team']]);
    const d = loaded.data[DEFAULT_WORKSPACE_ID];
    expect(d.collections).toHaveLength(45);
    expect(d.collections[44].info.name).toBe('Collection 44');
    expect(d.environments).toHaveLength(26);
    expect(d.environments[3]).toEqual(env('e3', 'Env 03'));
    expect(d.activeEnvironmentId).toBe('e3');
    expect(d.history).toHaveLength(5);
    expect(d.globals.values).toEqual([{ key: 'g', value: 'Default' }]);
    expect(loaded.data['ws-b'].collections.map((c) => c.info.name)).toEqual(['Same id in Team']);
    expect(loaded.data['ws-b'].runs.map((r) => r.id)).toEqual(['run-1']);
    expect(loaded.session).toEqual({});
    expect(loaded.drafts).toEqual({});

    // The new stores work: tabs and drafts round-trip per workspace, and deleting a workspace removes them.
    await store.put(STORES.tabs, { ws: DEFAULT_WORKSPACE_ID, tabs: [{ id: 'r:c1:i1' }, { id: 'n:t1', preview: true }], activeId: 'n:t1' });
    await store.put(STORES.tabs, { ws: 'ws-b', tabs: [{ id: 'r:c0:x' }], activeId: 'r:c0:x' });
    await store.put(STORES.drafts, { ws: DEFAULT_WORKSPACE_ID, id: 'n:t1', data: { id: 't1', name: 'Draft', request: { method: 'POST' } } });
    await store.put(STORES.drafts, { ws: 'ws-b', id: 'r:c0:x', data: { name: 'B draft', request: {} } });
    const again = await loadAll(store, DEFAULT_PREFS);
    expect(again.session[DEFAULT_WORKSPACE_ID]).toEqual({ tabs: [{ id: 'r:c1:i1' }, { id: 'n:t1', preview: true }], activeId: 'n:t1' });
    expect(again.drafts[DEFAULT_WORKSPACE_ID]['n:t1']).toMatchObject({ name: 'Draft' });
    await store.deleteWorkspace('ws-b');
    const after = await loadAll(store, DEFAULT_PREFS);
    expect(after.session['ws-b']).toBeUndefined();
    expect(after.drafts['ws-b']).toBeUndefined();
    expect(after.drafts[DEFAULT_WORKSPACE_ID]['n:t1']).toBeTruthy();
    store.close();

    const raw = await new Promise<IDBDatabase>((res, rej) => {
      const r = idb.open('apiclient');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect(raw.version).toBe(3);
    expect([...raw.objectStoreNames].sort()).toEqual(['collections', 'drafts', 'environments', 'history', 'kv', 'runs', 'tabs', 'workspaces']);
    raw.close();
  });
});
