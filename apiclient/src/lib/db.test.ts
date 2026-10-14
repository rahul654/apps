import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openStore, STORES } from './db';

describe('IndexedDB store', () => {
  it('creates stores, round-trips records, clears everything', async () => {
    const store = await openStore(new IDBFactory(), 'apiclient-test');
    await store.put(STORES.collections, { id: 'c1', data: { info: { name: 'x' } }, updatedAt: 'now' });
    await store.putMany(STORES.history, [{ id: 'h1', at: '1' }, { id: 'h2', at: '2' }]);
    await store.kvSet('globals', { values: [] });
    expect((await store.getAll(STORES.collections)).length).toBe(1);
    expect(await store.get(STORES.history, 'h2')).toEqual({ id: 'h2', at: '2' });
    expect(await store.kvGet('globals')).toEqual({ values: [] });
    expect(await store.kvGet('nope')).toBeUndefined();
    await store.delete(STORES.history, 'h1');
    expect((await store.getAll(STORES.history)).length).toBe(1);
    await store.clearAll();
    expect((await store.getAll(STORES.history)).length).toBe(0);
    expect(await store.kvGet('globals')).toBeUndefined();
    store.close();
  });
});
