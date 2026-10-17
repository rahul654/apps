/**
 * Minimal promise helpers over IndexedDB. All app data lives here; nothing is uploaded.
 *
 * Version 2 layout (multiple workspaces):
 *   workspaces    keyPath 'id'          WorkspaceRecord: meta + globals + activeEnvironmentId
 *   collections   keyPath ['ws','id']   { ws, id, data: PmCollection, updatedAt }
 *   environments  keyPath ['ws','id']   { ws, id, data: PmEnvironmentFile }
 *   history       keyPath ['ws','id']   { ws, id, data: HistoryEntry }
 *   runs          keyPath ['ws','id']   { ws, id, data: RunReport }
 *   kv            keyPath 'key'         app-wide values (none at the moment)
 * Keys are [workspace id, item id], so the same collection id can live in two workspaces and one
 * workspace's rows are a single key range ([ws] … [ws, []]).
 *
 * Version 3 adds the request-tab session, per workspace:
 *   tabs          keyPath 'ws'          { ws, tabs: TabRef[], activeId }   open tabs + the active one
 *   drafts        keyPath ['ws','id']   { ws, id: tab id, data, updatedAt } unsaved edits of a tab
 * The v2 → v3 upgrade only creates the two stores; no existing row is touched. They are not in
 * WS_STORES: imports (replaceWorkspace) keep the open tabs, deleting a workspace removes them.
 *
 * Version 1 (single data set) had the same store names keyed by 'id', with globals and the
 * active environment in kv. The upgrade moves everything into the Default workspace inside the
 * versionchange transaction, so it either completes or leaves version 1 untouched.
 */
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, EMPTY_GLOBALS, type WorkspaceData, type WorkspaceMeta } from './workspaces';
import type { PmEnvironmentFile } from './postman/types';
import type { TabsState } from './tabs';

export const DB_NAME = 'apiclient';
export const DB_VERSION = 3;
export const STORES = { workspaces: 'workspaces', collections: 'collections', environments: 'environments', history: 'history', runs: 'runs', kv: 'kv', tabs: 'tabs', drafts: 'drafts' } as const;
/** Stores whose rows belong to one workspace. */
export const WS_STORES = [STORES.collections, STORES.environments, STORES.history, STORES.runs] as const;
export type WsStore = (typeof WS_STORES)[number];

export interface WorkspaceRecord extends WorkspaceMeta {
  globals: PmEnvironmentFile;
  activeEnvironmentId: string | null;
}
/** One workspace's open tabs (DB v3). */
export interface TabsRow extends TabsState {
  ws: string;
}
export interface WsRow<T> {
  ws: string;
  id: string;
  data: T;
  updatedAt?: string;
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** All keys of one workspace in a [ws, id] store. Arrays sort after strings, so [ws, []] is past every [ws, '…']. */
export const wsRange = (ws: string): IDBKeyRange => IDBKeyRange.bound([ws], [ws, []]);

function createWsStores(db: IDBDatabase) {
  for (const n of WS_STORES) db.createObjectStore(n, { keyPath: ['ws', 'id'] });
}

/** v1 → v2: read every v1 row, recreate the stores with [ws, id] keys and write the rows back into Default. */
function migrateV1(db: IDBDatabase, tx: IDBTransaction) {
  const now = new Date().toISOString();
  const rows: Partial<Record<WsStore, unknown[]>> = {};
  let globals: PmEnvironmentFile | undefined;
  let active: string | null | undefined;
  let pending = WS_STORES.length + 2;
  const kv = tx.objectStore(STORES.kv);
  const step = () => {
    if (--pending) return;
    for (const n of WS_STORES) db.deleteObjectStore(n);
    createWsStores(db);
    const wrap = (n: WsStore, r: unknown): WsRow<unknown> | null => {
      const o = r as Record<string, unknown>;
      if (!o || typeof o.id !== 'string') return null;
      if (n === STORES.collections) return { ws: DEFAULT_WORKSPACE_ID, id: o.id, data: o.data, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now };
      return { ws: DEFAULT_WORKSPACE_ID, id: o.id, data: o };
    };
    for (const n of WS_STORES) {
      const s = tx.objectStore(n);
      for (const r of rows[n] ?? []) {
        const w = wrap(n, r);
        if (w) s.put(w);
      }
    }
    const envIds = new Set((rows.environments ?? []).map((e) => (e as { id?: unknown }).id));
    const record: WorkspaceRecord = {
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
      globals: globals && Array.isArray(globals.values) ? { ...globals, id: 'globals', _postman_variable_scope: 'globals' } : EMPTY_GLOBALS,
      activeEnvironmentId: typeof active === 'string' && envIds.has(active) ? active : null,
    };
    db.createObjectStore(STORES.workspaces, { keyPath: 'id' }).put(record);
    kv.delete('globals');
    kv.delete('activeEnvironmentId');
  };
  for (const n of WS_STORES) {
    const r = tx.objectStore(n).getAll();
    r.onsuccess = () => {
      rows[n] = r.result;
      step();
    };
  }
  const g = kv.get('globals');
  g.onsuccess = () => {
    globals = (g.result as { value?: PmEnvironmentFile } | undefined)?.value;
    step();
  };
  const a = kv.get('activeEnvironmentId');
  a.onsuccess = () => {
    active = (a.result as { value?: string | null } | undefined)?.value;
    step();
  };
}

export function openDatabase(idb: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore(STORES.kv, { keyPath: 'key' });
        db.createObjectStore(STORES.workspaces, { keyPath: 'id' });
        createWsStores(db);
      } else if (e.oldVersion < 2) {
        migrateV1(db, req.transaction!);
      }
      if (e.oldVersion < 3) {
        db.createObjectStore(STORES.tabs, { keyPath: 'ws' });
        db.createObjectStore(STORES.drafts, { keyPath: ['ws', 'id'] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('API Client storage is blocked by another open tab. Close other API Client tabs and reload.'));
  });
}

const now = () => new Date().toISOString();

/** Rows for one workspace's data, in the shape the stores keep. */
export function rowsOf(ws: string, d: WorkspaceData, at = now()): Record<WsStore, WsRow<unknown>[]> {
  return {
    collections: d.collections.map((c) => ({ ws, id: c.info._postman_id ?? '', data: c, updatedAt: at })),
    environments: d.environments.map((e) => ({ ws, id: e.id ?? '', data: e })),
    history: d.history.map((h) => ({ ws, id: h.id, data: h })),
    runs: d.runs.map((r) => ({ ws, id: r.id, data: r })),
  };
}

export class Store {
  constructor(private db: IDBDatabase) {}

  async getAll<T>(store: string, query?: IDBKeyRange): Promise<T[]> {
    return request(this.db.transaction(store, 'readonly').objectStore(store).getAll(query)) as Promise<T[]>;
  }
  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return request(this.db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
  }
  async put(store: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await transactionDone(tx);
  }
  async putMany(store: string, values: unknown[]): Promise<void> {
    if (!values.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    for (const v of values) tx.objectStore(store).put(v);
    await transactionDone(tx);
  }
  async delete(store: string, key: IDBValidKey | IDBKeyRange): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
  }
  async clear(store: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await transactionDone(tx);
  }
  async clearAll(): Promise<void> {
    const names = Object.values(STORES);
    const tx = this.db.transaction(names, 'readwrite');
    for (const n of names) tx.objectStore(n).clear();
    await transactionDone(tx);
  }
  /** Writes a workspace record and replaces all of its rows, atomically. */
  async replaceWorkspace(record: WorkspaceRecord, data: WorkspaceData): Promise<void> {
    const tx = this.db.transaction([STORES.workspaces, ...WS_STORES], 'readwrite');
    tx.objectStore(STORES.workspaces).put(record);
    const rows = rowsOf(record.id, data);
    for (const n of WS_STORES) {
      const s = tx.objectStore(n);
      s.delete(wsRange(record.id));
      for (const r of rows[n]) s.put(r);
    }
    await transactionDone(tx);
  }
  /** Deletes a workspace record, all of its rows, its open tabs and drafts, atomically. */
  async deleteWorkspace(ws: string): Promise<void> {
    const tx = this.db.transaction([STORES.workspaces, ...WS_STORES, STORES.tabs, STORES.drafts], 'readwrite');
    tx.objectStore(STORES.workspaces).delete(ws);
    for (const n of WS_STORES) tx.objectStore(n).delete(wsRange(ws));
    tx.objectStore(STORES.tabs).delete(ws);
    tx.objectStore(STORES.drafts).delete(wsRange(ws));
    await transactionDone(tx);
  }
  async kvGet<T>(key: string): Promise<T | undefined> {
    const row = await this.get<{ key: string; value: T }>(STORES.kv, key);
    return row?.value;
  }
  async kvSet(key: string, value: unknown): Promise<void> {
    await this.put(STORES.kv, { key, value });
  }
  close() {
    this.db.close();
  }
}

export async function openStore(idb?: IDBFactory, name?: string): Promise<Store> {
  return new Store(await openDatabase(idb, name));
}
