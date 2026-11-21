import { describe, expect, it } from 'vitest';
import { searchCollections, snippetOf, type SearchOptions } from './search';
import type { PmCollection } from './postman/types';

const col = (id: string, name: string, item: PmCollection['item']): PmCollection => ({ info: { _postman_id: id, name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item });
const A = col('A', 'Shop API', [
  { id: 'r1', name: 'List orders', request: { method: 'get', url: { raw: '{{baseUrl}}/v1/orders?page=1' } }, response: [{ id: 'e1', name: 'OK', code: 200, status: 'OK', body: '{"orders":[{"id":"ORD-42","status":"shipped"}]}' }] },
  { id: 'f', name: 'Admin', item: [{ id: 'r2', name: 'Delete user', request: { method: 'DELETE', url: 'https://api.shop.dev/users/7' }, response: [{ id: 'e2', name: 'Not found', code: 404, status: 'Not Found', body: 'no such user' }] }] },
]);
const B = col('B', 'Payments', [{ id: 'p1', name: 'Refund order', request: { method: 'POST', url: '{{pay}}/refunds' } }]);
const all: SearchOptions = { cid: null, fields: ['name', 'url', 'response'] };

describe('searchCollections', () => {
  it('finds request names across collections, with path and method', () => {
    const r = searchCollections([A, B], 'order', { ...all, fields: ['name'] });
    expect(r.map((x) => [x.collectionName, x.name, x.method])).toEqual([['Shop API', 'List orders', 'GET'], ['Payments', 'Refund order', 'POST']]);
  });

  it('searches URLs, including {{variables}}, and nested folders', () => {
    const r = searchCollections([A, B], 'users', { ...all, fields: ['url'] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'request', iid: 'r2', path: ['Admin'], matched: ['url'] });
    expect(r[0].snippet.match).toBe('users');
    expect(searchCollections([A, B], '{{pay}}', { ...all, fields: ['url'] })[0].name).toBe('Refund order');
  });

  it('searches saved responses: body, name and status', () => {
    const body = searchCollections([A, B], 'ORD-42', { ...all, fields: ['response'] });
    expect(body).toEqual([expect.objectContaining({ kind: 'response', iid: 'r1', eid: 'e1', exampleName: 'OK' })]);
    expect(body[0].snippet.match).toBe('ORD-42');
    expect(searchCollections([A, B], '404', { ...all, fields: ['response'] })[0].eid).toBe('e2');
  });

  it('only searches the chosen fields and collection', () => {
    expect(searchCollections([A, B], 'orders', { ...all, fields: ['url'] }).map((x) => x.iid)).toEqual(['r1']);
    expect(searchCollections([A, B], 'order', { cid: 'B', fields: ['name', 'url', 'response'] }).map((x) => x.iid)).toEqual(['p1']);
    expect(searchCollections([A, B], 'order', { cid: null, fields: [] })).toEqual([]);
    expect(searchCollections([A, B], '   ', all)).toEqual([]);
  });

  it('reports every matching field once per request; all words must match in one field', () => {
    const r = searchCollections([A, B], 'orders', all);
    expect(r[0]).toMatchObject({ iid: 'r1', matched: ['name', 'url'] });
    expect(r[1]).toMatchObject({ kind: 'response', eid: 'e1' });
    expect(searchCollections([A, B], 'list v1', all)).toEqual([]); // "list" only in the name, "v1" only in the URL
    expect(searchCollections([A, B], 'LIST orders', all)[0].iid).toBe('r1'); // case-insensitive
  });

  it('stops at the limit', () => {
    expect(searchCollections([A, B], 'o', { ...all, limit: 2 })).toHaveLength(2);
  });
});

describe('snippetOf', () => {
  it('cuts long text around the match and flattens whitespace', () => {
    const text = 'a'.repeat(200) + '\nNEEDLE\n' + 'b'.repeat(200);
    const s = snippetOf(text, [201, 207], 40);
    expect(s.match).toBe('NEEDLE');
    expect(s.before.startsWith('…')).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
    expect((s.before + s.match + s.after).length).toBeLessThanOrEqual(44);
    expect(s.before.endsWith(' ')).toBe(true);
  });
});
