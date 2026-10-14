import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import realistic from './__fixtures__/realistic.postman_collection.json';
import v20 from './__fixtures__/v20.postman_collection.json';
import envFixture from './__fixtures__/env.postman_environment.json';
import globalsFixture from './__fixtures__/globals.postman_globals.json';
import { toCollectionFile, toEnvironmentFile } from './export';
import { curlToRequest, openApiToCollection, parseOpenApiText, shellSplit } from './importers';
import { findItem, insertItem, listRequests, moveItem, removeItem, updateItem } from './items';
import { detectPostmanJson, normalizeCollection, normalizeEnvironment, parseRawUrl, urlObjectToString } from './normalize';
import { COLLECTION_SCHEMA_V21, type PmItem, type PmItemGroup } from './types';
import { validateCollection, validateEnvironment } from './validate';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('schema validation of fixtures and exports', () => {
  it('the checked-in fixtures validate against the official v2.1 schema', () => {
    expect(validateCollection(realistic)).toEqual([]);
    expect(validateEnvironment(envFixture)).toEqual([]);
    expect(validateEnvironment(globalsFixture)).toEqual([]);
  });

  it('rejects an invalid collection (missing info.schema)', () => {
    const bad = clone(realistic) as { info: Record<string, unknown> };
    delete bad.info.schema;
    expect(validateCollection(bad).length).toBeGreaterThan(0);
  });

  it('exported collections (v2.1 and converted v2.0) validate', () => {
    expect(validateCollection(toCollectionFile(normalizeCollection(realistic)))).toEqual([]);
    const converted = toCollectionFile(normalizeCollection(v20));
    expect(validateCollection(converted)).toEqual([]);
    expect(converted.info.schema).toBe(COLLECTION_SCHEMA_V21);
  });

  it('exported environments and globals validate', () => {
    expect(validateEnvironment(toEnvironmentFile(normalizeEnvironment(envFixture), 'environment'))).toEqual([]);
    expect(validateEnvironment(toEnvironmentFile(normalizeEnvironment(globalsFixture, 'globals'), 'globals'))).toEqual([]);
    const fresh = toEnvironmentFile({ id: 'x', name: 'New', values: [{ key: 'a', value: '1' }] });
    expect(validateEnvironment(fresh)).toEqual([]);
    expect(fresh._postman_variable_scope).toBe('environment');
    expect(fresh.values[0]).toEqual({ key: 'a', value: '1', type: 'default', enabled: true });
  });

  it('a collection built from scratch in the app exports valid', () => {
    const c = normalizeCollection({ info: { name: 'New', schema: COLLECTION_SCHEMA_V21 }, item: [] });
    const withItems = insertItem(insertItem(c, null, { id: 'f1', name: 'Folder', item: [] }), 'f1', { id: 'r1', name: 'Req', request: { method: 'GET', header: [], url: parseRawUrl('https://a.b/c?d=1') }, response: [] });
    expect(validateCollection(toCollectionFile(withItems))).toEqual([]);
  });
});

describe('round trips', () => {
  it('v2.1 import → export keeps every field Postman cares about (deep equal after id-fill)', () => {
    const imported = normalizeCollection(clone(realistic));
    const exported = toCollectionFile(imported);
    // Folders/items gained ids (allowed by the schema); everything else is byte-for-byte the input.
    const stripIds = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(stripIds);
      if (x && typeof x === 'object') {
        const o = { ...(x as Record<string, unknown>) };
        if ('request' in o || 'item' in o) delete o.id;
        if ('code' in o && 'originalRequest' in o) delete o.id;
        for (const k of Object.keys(o)) o[k] = stripIds(o[k]);
        return o;
      }
      return x;
    };
    expect(stripIds(exported)).toEqual(realistic);
    expect(exported.info._exporter_id).toBe('123456');
    expect(exported.protocolProfileBehavior).toEqual({ disableBodyPruning: true });
    // Second round trip is stable, ids included.
    expect(toCollectionFile(normalizeCollection(clone(exported)))).toEqual(exported);
  });

  it('v2.0 → v2.1 conversion: auth attributes become arrays, string headers/urls become objects', () => {
    const c = normalizeCollection(clone(v20));
    const first = c.item[0] as PmItem;
    const req = first.request as Exclude<PmItem['request'], string>;
    expect(req.auth).toEqual({ type: 'basic', basic: [{ key: 'username', value: 'u', type: 'string' }, { key: 'password', value: 'p', type: 'string' }] });
    expect(req.header).toEqual([{ key: 'Accept', value: 'application/json' }, { key: 'X-Trace', value: '1' }]);
    expect(c.auth).toEqual({ type: 'apikey', apikey: [{ key: 'key', value: 'X-Key', type: 'string' }, { key: 'value', value: 'k', type: 'string' }, { key: 'in', value: 'header', type: 'string' }] });
    expect((c.item[1] as PmItem).request).toEqual({ method: 'GET', url: 'https://example.com/str', header: [] });
    const nested = (c.item[2] as PmItemGroup).item[0] as PmItem;
    expect(nested.event?.[0].script?.exec).toEqual(["pm.test('x', function(){});"]);
    expect(nested.event?.[0].script?.type).toBe('text/javascript');
    expect(nested.id).toBeTruthy();
  });

  it('environment round trip keeps values, types and enabled flags', () => {
    const env = normalizeEnvironment(clone(envFixture));
    const out = toEnvironmentFile(env);
    expect(out.id).toBe(envFixture.id);
    expect(out.name).toBe('Staging');
    expect(out.values).toEqual(envFixture.values);
    expect(out._postman_exported_using).toMatch(/API Client/);
  });

  it('rejects v1 collections and junk with a clear message', () => {
    expect(() => normalizeCollection({ name: 'x', requests: [], order: [] })).toThrow(/v1/);
    expect(() => normalizeCollection({ hello: 1 })).toThrow(/Not a Postman collection/);
    expect(() => normalizeEnvironment({ a: 1 })).toThrow(/environment/);
  });

  it('detects file kinds', () => {
    expect(detectPostmanJson(realistic)).toBe('collection');
    expect(detectPostmanJson(v20)).toBe('collection');
    expect(detectPostmanJson(envFixture)).toBe('environment');
    expect(detectPostmanJson(globalsFixture)).toBe('globals');
    expect(detectPostmanJson({ openapi: '3.0.0' })).toBe('openapi');
    expect(detectPostmanJson({ name: 'x', requests: [], order: [] })).toBe('collection-v1');
    expect(detectPostmanJson(null)).toBeNull();
  });
});

describe('url helpers', () => {
  it('parses raw urls into Postman url objects and back', () => {
    const u = parseRawUrl('https://api.example.com:8443/users/:id/posts?page=2&q=a%20b&flag#top');
    expect(u).toEqual({
      raw: 'https://api.example.com:8443/users/:id/posts?page=2&q=a%20b&flag#top',
      protocol: 'https',
      host: ['api', 'example', 'com'],
      port: '8443',
      path: ['users', ':id', 'posts'],
      query: [{ key: 'page', value: '2' }, { key: 'q', value: 'a%20b' }, { key: 'flag', value: null }],
      hash: 'top',
      variable: [{ key: 'id', value: '' }],
    });
    expect(urlObjectToString({ ...u, raw: undefined })).toBe('https://api.example.com:8443/users/:id/posts?page=2&q=a%20b&flag#top');
    expect(parseRawUrl('{{baseUrl}}/x').host).toEqual(['{{baseUrl}}']);
    expect(urlObjectToString({ host: ['{{baseUrl}}'], path: ['x'], query: [{ key: 'a', value: '1', disabled: true }] })).toBe('{{baseUrl}}/x');
  });
});

describe('item tree edits', () => {
  const c = normalizeCollection(clone(realistic));
  const ids = () => listRequests(c).map((r) => r.item.name);
  it('lists requests depth-first with parents', () => {
    expect(ids()).toEqual(['Login', 'Inherits basic', 'Upload', 'Form', 'GraphQL', 'OAuth kept']);
    const inh = listRequests(c)[1];
    expect(inh.parents.map((p) => p.name)).toEqual(['Auth', 'Nested']);
    expect(listRequests(c, (c.item[0] as PmItemGroup).id).map((r) => r.item.name)).toEqual(['Login', 'Inherits basic']);
  });
  it('update, remove, insert and move are immutable and keep others intact', () => {
    const login = listRequests(c)[0].item;
    const updated = updateItem(c, login.id!, (it) => ({ ...it, name: 'Login2' }));
    expect(listRequests(updated)[0].item.name).toBe('Login2');
    expect(c.item[0]).not.toBe(updated.item[0]);
    expect(c.item[1]).toBe(updated.item[1]);
    const removed = removeItem(c, login.id!);
    expect(listRequests(removed).map((r) => r.item.name)).not.toContain('Login');
    const upload = c.item[1];
    const moved = moveItem(c, upload.id!, (c.item[0] as PmItemGroup).id!, 0);
    expect((moved.item[0] as PmItemGroup).item[0].name).toBe('Upload');
    expect(moved.item.length).toBe(c.item.length - 1);
    const sameParent = moveItem(c, c.item[3].id!, null, 1);
    expect(sameParent.item.map((i) => i.name)).toEqual(['Auth', 'GraphQL', 'Upload', 'Form', 'OAuth kept']);
    expect(moveItem(c, (c.item[0] as PmItemGroup).id!, (c.item[0] as PmItemGroup).id!, 0)).toBe(c);
    expect(findItem(c, 'nope')).toBeNull();
  });
});

describe('curl import', () => {
  it('splits shell words', () => {
    expect(shellSplit(`curl -H 'a: b c' "x \\" y" plain\\ word`)).toEqual(['curl', '-H', 'a: b c', 'x " y', 'plain word']);
  });
  it('converts a typical curl with json body, headers and basic auth', () => {
    const { name, request } = curlToRequest(`curl -X POST 'https://api.example.com/v1/items?x=1' \\\n -H 'Authorization: Bearer t' -H "Content-Type: application/json" --data-raw '{"a":1}' -u me:pw`);
    expect(name).toBe('POST /v1/items?…');
    expect(request.method).toBe('POST');
    expect(request.header).toEqual([{ key: 'Authorization', value: 'Bearer t' }, { key: 'Content-Type', value: 'application/json' }]);
    expect(request.body).toEqual({ mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } });
    expect(request.auth?.type).toBe('basic');
    expect((request.url as { raw: string }).raw).toBe('https://api.example.com/v1/items?x=1');
  });
  it('infers POST + urlencoded from -d and form-data from -F', () => {
    expect(curlToRequest(`curl https://e.com -d a=1 -d 'b=x y'`).request.body).toEqual({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: 'x y' }] });
    expect(curlToRequest(`curl https://e.com -F t=1 -F file=@/tmp/a.png`).request.body).toEqual({ mode: 'formdata', formdata: [{ key: 't', value: '1', type: 'text' }, { key: 'file', type: 'file', src: '/tmp/a.png' }] });
    expect(() => curlToRequest('wget x')).toThrow();
  });
});

describe('OpenAPI import', () => {
  it('builds folders per tag, path variables, query params, example bodies; output validates', async () => {
    const doc = await parseOpenApiText(`openapi: 3.0.0
info: { title: Pets, version: '1' }
servers: [{ url: https://pets.example.com/v1 }]
components:
  securitySchemes: { bearerAuth: { type: http, scheme: bearer } }
  schemas:
    Pet: { type: object, properties: { name: { type: string }, age: { type: integer }, tags: { type: array, items: { type: string } } } }
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      parameters: [{ name: limit, in: query, schema: { type: integer, default: 10 } }]
    post:
      tags: [pets]
      operationId: createPet
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
  /pets/{petId}:
    delete:
      summary: Delete
      parameters: [{ name: petId, in: path, required: true, schema: { type: string } }]
`);
    const col = openApiToCollection(doc);
    expect(col.info.name).toBe('Pets');
    expect(col.variable?.[0]).toEqual({ key: 'baseUrl', value: 'https://pets.example.com/v1', type: 'string' });
    expect(col.auth?.type).toBe('bearer');
    const pets = col.item[0] as PmItemGroup;
    expect(pets.name).toBe('pets');
    expect(pets.item.map((i) => i.name)).toEqual(['List pets', 'createPet']);
    const create = pets.item[1] as PmItem;
    expect(JSON.parse(((create.request as { body: { raw: string } }).body).raw)).toEqual({ name: 'string', age: 0, tags: ['string'] });
    const del = col.item[1] as PmItem;
    expect((del.request as { url: { raw: string; variable: unknown[] } }).url.raw).toBe('{{baseUrl}}/pets/:petId');
    expect(validateCollection(toCollectionFile(col))).toEqual([]);
    expect(() => openApiToCollection({})).toThrow();
    // JSON form too
    expect((await parseOpenApiText('{"openapi":"3.1.0","paths":{}}')).openapi).toBe('3.1.0');
  });
});

describe('schema file provenance', () => {
  it('README documents the sources', () => {
    const readme = readFileSync(new URL('./__schemas__/README.md', import.meta.url), 'utf8');
    expect(readme).toContain('schema.postman.com/json/collection/v2.1.0/collection.json');
    expect(readme).toContain('Apache');
  });
});
