/** Minimal promise helpers over IndexedDB. Awaiting these inside a transaction is safe. */

export const DB_VERSION = 1;

export const STORES = { boards: 'boards', scenes: 'scenes', files: 'files', thumbs: 'thumbs', kv: 'kv' } as const;

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

/**
 * Opens (and creates or upgrades) the database. Store layout changes go in `upgrade` by
 * `oldVersion`; record-shape changes are handled by schema.ts migrations instead.
 */
export function openDatabase(name: string, idb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore(STORES.boards, { keyPath: 'id' });
        db.createObjectStore(STORES.scenes, { keyPath: 'id' });
        const files = db.createObjectStore(STORES.files, { keyPath: ['boardId', 'id'] });
        files.createIndex('boardId', 'boardId');
        db.createObjectStore(STORES.thumbs, { keyPath: 'id' });
        db.createObjectStore(STORES.kv, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema: let it, this tab reloads its data on next open.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('Whiteboard storage is blocked by another open tab. Close other Whiteboard tabs and reload.'));
  });
}
