import { describe, expect, it } from 'vitest';
import type { PmCollection, PmItem, PmItemGroup } from '../postman/types';
import { applyAuth, buildRequest, effectiveAuth, encodeQueryPart, forbiddenHeaders } from './build';
import { toCurl, toFetch } from './snippets';

const scopes = { environment: { baseUrl: 'https://api.example.com', token: 'T0K', id: '7' }, globals: { q: 'g v' } };
const item = (request: PmItem['request'], id = 'r1'): PmItem => ({ id, name: 'R', request });

describe('buildRequest', () => {
  it('resolves url, merges query params from the url object, applies path variables and headers', () => {
    const r = buildRequest(
      item({
        method: 'get',
        header: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Off', value: '1', disabled: true }, { key: 'X-Tok', value: '{{token}}' }],
        url: { raw: '{{baseUrl}}/users/:id?page=1&q={{q}}&off=1', host: ['{{baseUrl}}'], path: ['users', ':id'], query: [{ key: 'page', value: '1' }, { key: 'q', value: '{{q}}' }, { key: 'off', value: '1', disabled: true }], variable: [{ key: 'id', value: '{{id}}' }] },
      }),
      { scopes },
    );
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.com/users/7?page=1&q=g%20v');
    expect(r.headers).toEqual([{ key: 'Accept', value: 'application/json' }, { key: 'X-Tok', value: 'T0K' }]);
    expect(r.missing).toEqual([]);
    expect(r.body).toEqual({ kind: 'none' });
  });
  it('falls back to the raw query string when there is no url object and reports missing variables', () => {
    const r = buildRequest(item({ method: 'POST', url: '{{nope}}/x?a=1&b' }), { scopes });
    expect(r.url).toBe('http://{{nope}}/x?a=1&b');
    expect(r.missing).toEqual(['nope']);
  });
  it('encodes raw json, urlencoded, graphql bodies and sets Content-Type unless present', () => {
    const json = buildRequest(item({ method: 'POST', url: 'https://e.com', body: { mode: 'raw', raw: '{"t":"{{token}}"}', options: { raw: { language: 'json' } } } }), { scopes });
    expect(json.body).toEqual({ kind: 'text', text: '{"t":"T0K"}', contentType: 'application/json' });
    expect(json.headers).toEqual([{ key: 'Content-Type', value: 'application/json' }]);
    const custom = buildRequest(item({ method: 'POST', url: 'https://e.com', header: [{ key: 'content-type', value: 'text/x-custom' }], body: { mode: 'raw', raw: 'x' } }), { scopes });
    expect(custom.headers).toEqual([{ key: 'content-type', value: 'text/x-custom' }]);
    const form = buildRequest(item({ method: 'POST', url: 'https://e.com', body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1 2' }, { key: 'b&', value: '{{token}}' }, { key: 'off', value: 'x', disabled: true }] } }), { scopes });
    expect(form.body).toEqual({ kind: 'text', text: 'a=1+2&b%26=T0K', contentType: 'application/x-www-form-urlencoded' });
    const gql = buildRequest(item({ method: 'POST', url: 'https://e.com', body: { mode: 'graphql', graphql: { query: 'query { a }', variables: '{"x": 1}' } } }), { scopes });
    expect(gql.body).toEqual({ kind: 'text', text: '{"query":"query { a }","variables":{"x":1}}', contentType: 'application/json' });
    const badVars = buildRequest(item({ method: 'POST', url: 'https://e.com', body: { mode: 'graphql', graphql: { query: 'q', variables: '{bad' } } }), { scopes });
    expect(badVars.warnings[0]).toMatch(/variables/);
    const disabled = buildRequest(item({ method: 'POST', url: 'https://e.com', body: { mode: 'raw', raw: 'x', disabled: true } }), { scopes });
    expect(disabled.body).toEqual({ kind: 'none' });
  });
  it('form-data uses the session file lookup and warns when a file is missing', () => {
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    const r = buildRequest(item({ method: 'POST', url: 'https://e.com', body: { mode: 'formdata', formdata: [{ key: 't', value: 'v', type: 'text' }, { key: 'f', type: 'file', src: 'a.txt' }, { key: 'g', type: 'file', src: 'missing.bin' }] } }), {
      scopes,
      files: (id, slot) => (id === 'r1' && slot === 'formdata:f' ? file : undefined),
    });
    expect(r.body.kind).toBe('form');
    if (r.body.kind === 'form') expect(r.body.parts).toEqual([{ key: 't', value: 'v', contentType: undefined }, { key: 'f', file, fileName: 'a.txt', contentType: undefined }]);
    expect(r.warnings).toEqual(['File for form field "g" is not loaded in this session; pick it again.']);
  });
  it('applies auth: bearer, basic, api key header/query, inherited from folder and collection', () => {
    const r = (s: string) => s.replace('{{token}}', 'T0K');
    expect(applyAuth({ type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }, r).headers).toEqual([{ key: 'Authorization', value: 'Bearer T0K' }]);
    expect(applyAuth({ type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p:w' }] }, r).headers).toEqual([{ key: 'Authorization', value: 'Basic dTpwOnc=' }]);
    expect(applyAuth({ type: 'apikey', apikey: [{ key: 'key', value: 'X-Key' }, { key: 'value', value: 'k' }] }, r).headers).toEqual([{ key: 'X-Key', value: 'k' }]);
    expect(applyAuth({ type: 'apikey', apikey: [{ key: 'key', value: 'api_key' }, { key: 'value', value: 'k' }, { key: 'in', value: 'query' }] }, r).query).toEqual([{ key: 'api_key', value: 'k' }]);
    expect(applyAuth({ type: 'oauth2', oauth2: [{ key: 'accessToken', value: 'A' }] }, r).headers).toEqual([{ key: 'Authorization', value: 'Bearer A' }]);
    expect(applyAuth({ type: 'oauth2', oauth2: [] }, r).warnings[0]).toMatch(/OAuth/);
    expect(applyAuth({ type: 'hawk' }, r).warnings[0]).toMatch(/not supported/);
    expect(applyAuth({ type: 'noauth' }, r).headers).toEqual([]);

    const collection: PmCollection = { info: { name: 'c', schema: '' }, item: [], auth: { type: 'bearer', bearer: [{ key: 'token', value: 'COL' }] } };
    const folder: PmItemGroup = { id: 'f', name: 'f', item: [], auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] } };
    const inherit = item({ method: 'GET', url: 'https://e.com' });
    expect(effectiveAuth(inherit.request as { auth?: never }, [folder], collection)?.type).toBe('basic');
    expect(effectiveAuth(inherit.request as { auth?: never }, [], collection)?.type).toBe('bearer');
    expect(effectiveAuth({ auth: { type: 'noauth' } }, [folder], collection)?.type).toBe('noauth');
    expect(effectiveAuth({ auth: null }, [folder], collection)).toBeNull();
    const built = buildRequest(inherit, { scopes, parents: [folder], collection });
    expect(built.headers).toEqual([{ key: 'Authorization', value: 'Basic dTpw' }]);
    const explicit = buildRequest(item({ method: 'GET', url: 'https://e.com', header: [{ key: 'Authorization', value: 'custom' }] }), { scopes, collection });
    expect(explicit.headers).toEqual([{ key: 'Authorization', value: 'custom' }]);
  });
  it('flags forbidden headers and encodes query parts conservatively', () => {
    expect(forbiddenHeaders([{ key: 'Cookie', value: 'a' }, { key: 'X-Ok', value: '1' }, { key: 'Sec-Fetch-Mode', value: 'x' }])).toEqual(['Cookie', 'Sec-Fetch-Mode']);
    expect(encodeQueryPart('a b%20c%zz/é')).toBe('a%20b%20c%25zz/%C3%A9');
  });
});

describe('snippets', () => {
  const req = buildRequest(item({ method: 'POST', url: "https://e.com/it's", header: [{ key: 'X-A', value: '1' }], body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } } }), { scopes });
  it('curl', () => {
    expect(toCurl(req)).toBe(`curl -X POST 'https://e.com/it'\\''s' \\\n  -H 'X-A: 1' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"a":1}'`);
  });
  it('fetch', () => {
    const s = toFetch(req);
    expect(s).toContain('const res = await fetch("https://e.com/it\'s", {');
    expect(s).toContain('"X-A": "1"');
    expect(s).toContain('body: "{\\"a\\":1}"');
  });
});
