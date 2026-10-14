/** Minimal promise helpers over IndexedDB. All app data lives here; nothing is uploaded. */
export const DB_NAME = 'apiclient';
export const DB_VERSION = 1;
export const STORES = { collections: 'collections', environments: 'environments', history: 'history', runs: 'runs', kv: 'kv' } as const;

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

export function openDatabase(idb: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore(STORES.collections, { keyPath: 'id' });
        db.createObjectStore(STORES.environments, { keyPath: 'id' });
        const h = db.createObjectStore(STORES.history, { keyPath: 'id' });
        h.createIndex('at', 'at');
        db.createObjectStore(STORES.runs, { keyPath: 'id' });
        db.createObjectStore(STORES.kv, { keyPath: 'key' });
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

export class Store {
  constructor(private db: IDBDatabase) {}

  async getAll<T>(store: string): Promise<T[]> {
    return request(this.db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
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
  async delete(store: string, key: IDBValidKey): Promise<void> {
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
