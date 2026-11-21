import { describe, expect, it } from 'vitest';
import type { PmCollection, PmEnvironmentFile, PmItem, PmItemGroup } from './postman/types';
import { findVariable, setEnvValue, setPmVariable, variableTokens, varSources } from './varScope';
import { lookup, varsFromList } from './variables';
import { scopedVariables } from './postman/items';

const env: PmEnvironmentFile = {
  id: 'env1',
  name: 'Staging',
  values: [
    { key: 'url', value: 'https://staging', type: 'default', enabled: true },
    { key: 'token', value: 's3cret', type: 'secret', enabled: true },
    { key: 'off', value: 'x', enabled: false },
    { key: 'dup', value: 'first', enabled: true },
    { key: 'dup', value: 'second', enabled: true },
  ],
};
const globals: PmEnvironmentFile = { id: 'globals', name: 'Globals', values: [{ key: 'region', value: 'eu' }, { key: 'url', value: 'global-url' }, { key: 'off', value: 'from globals' }] };
const folder: PmItemGroup = { id: 'f1', name: 'Auth', item: [], variable: [{ key: 'folderVar', value: 'F' }, { key: 'shared', value: 'folder' }] };
const outer: PmItemGroup = { id: 'f0', name: 'Outer', item: [folder], variable: [{ key: 'shared', value: 'outer' }, { key: 'outerOnly', value: 'O' }] };
const item: PmItem = { id: 'i1', name: 'Login', request: { method: 'GET' }, variable: [{ key: 'reqVar', value: 'R' }] };
const collection: PmCollection = { info: { _postman_id: 'c1', name: 'API', schema: '' }, item: [outer], variable: [{ key: 'shared', value: 'collection' }, { key: 'colOnly', value: 7 }, { key: 'hidden', value: 'h', disabled: true }] };

const sources = varSources({ environment: env, collection, parents: [outer, folder], item, globals });

describe('findVariable', () => {
  it('labels each scope', () => {
    expect(findVariable('url', sources)).toMatchObject({ status: 'ok', label: 'Environment "Staging"', value: 'https://staging', secret: false, editable: true });
    expect(findVariable('token', sources)).toMatchObject({ label: 'Environment "Staging"', secret: true });
    expect(findVariable('reqVar', sources)).toMatchObject({ label: 'Request', value: 'R' });
    expect(findVariable('shared', sources)).toMatchObject({ label: 'Folder "Auth"', value: 'folder' });
    expect(findVariable('outerOnly', sources)).toMatchObject({ label: 'Folder "Outer"', source: { kind: 'folder', id: 'f0' } });
    expect(findVariable('colOnly', sources)).toMatchObject({ label: 'Collection', value: '7' });
    expect(findVariable('region', sources)).toMatchObject({ label: 'Globals', value: 'eu' });
    expect(findVariable(' $guid ', sources)).toMatchObject({ name: '$guid', status: 'dynamic', label: 'Dynamic', editable: false });
    expect(findVariable('nope', sources)).toMatchObject({ status: 'missing', source: null, editable: true });
    expect(findVariable('hidden', sources).status).toBe('missing');
  });

  it('disabled entries are skipped (falling through to a lower scope) and the last duplicate wins', () => {
    expect(findVariable('off', sources)).toMatchObject({ label: 'Globals', value: 'from globals' });
    expect(findVariable('dup', sources).value).toBe('second');
  });

  it('iteration data and local values come first and are read-only', () => {
    const s = varSources({ data: { url: 'from-data' }, local: { region: 'local' }, environment: env, collection, parents: [], globals });
    expect(findVariable('url', s)).toMatchObject({ label: 'Iteration data', value: 'from-data', editable: false });
    expect(findVariable('region', s)).toMatchObject({ label: 'Local', editable: false });
  });

  it('agrees with the resolver used for sending, for every name', () => {
    const scopes = { environment: varsFromList(env.values), collectionChain: scopedVariables(collection, [outer, folder], item).map(varsFromList), globals: varsFromList(globals.values) };
    for (const name of ['url', 'token', 'off', 'dup', 'reqVar', 'shared', 'outerOnly', 'folderVar', 'colOnly', 'hidden', 'region', 'nope']) {
      const info = findVariable(name, sources);
      const v = lookup(name, scopes);
      expect(info.status === 'ok' ? info.value : undefined, name).toBe(v);
    }
  });
});

describe('variableTokens', () => {
  it('finds names with offsets', () => {
    expect(variableTokens('{{url}}/a/{{ id }}?x={{$guid}}')).toEqual([
      { name: 'url', from: 0, to: 7 },
      { name: 'id', from: 10, to: 18 },
      { name: '$guid', from: 21, to: 30 },
    ]);
    expect(variableTokens('plain')).toEqual([]);
  });
});

describe('write helpers', () => {
  it('setEnvValue updates the winning entry or appends an enabled one', () => {
    expect(setEnvValue(env.values, 'dup', 'new').map((v) => v.value)).toEqual(['https://staging', 's3cret', 'x', 'first', 'new']);
    expect(setEnvValue(env.values, 'off', 'on').slice(-1)).toEqual([{ key: 'off', value: 'on', type: 'default', enabled: true }]);
    expect(setEnvValue(env.values, 'token', 't2')[1]).toEqual({ key: 'token', value: 't2', type: 'secret', enabled: true });
  });

  it('setPmVariable updates or appends a string variable, skipping disabled ones', () => {
    expect(setPmVariable(collection.variable, 'colOnly', '8')[1]).toEqual({ key: 'colOnly', value: '8' });
    expect(setPmVariable(collection.variable, 'hidden', 'v').slice(-1)).toEqual([{ key: 'hidden', value: 'v', type: 'string' }]);
    expect(setPmVariable(undefined, 'k', 'v')).toEqual([{ key: 'k', value: 'v', type: 'string' }]);
  });
});
