import { describe, expect, it } from 'vitest';
import { flatten, referencedVariables, resolve, varsFromList, type Scopes, type VarMap } from './variables';

describe('variable resolution', () => {
  const chain: VarMap[] = [{ a: 'request' }, { a: 'folder', f: 'F' }, { a: 'collection', b: 'B' }];
  const scopes: Scopes & { collectionChain: VarMap[] } = {
    globals: { a: 'global', g: 'G', nested: '{{a}}-{{b}}' },
    collectionChain: chain,
    environment: { a: 'env', e: 'E' },
    data: { a: 'data', d: 'D' },
    local: { a: 'local', l: 'L' },
  };
  it('applies Postman precedence: local > data > environment > request > folder > collection > globals', () => {
    expect(resolve('{{a}}', scopes).text).toBe('local');
    expect(resolve('{{a}}', { ...scopes, local: {} }).text).toBe('data');
    expect(resolve('{{a}}', { ...scopes, local: {}, data: {} }).text).toBe('env');
    expect(resolve('{{a}}', { ...scopes, local: {}, data: {}, environment: {} }).text).toBe('request');
    expect(resolve('{{a}}', { ...scopes, local: {}, data: {}, environment: {}, collectionChain: scopes.collectionChain.slice(1) }).text).toBe('folder');
    expect(resolve('{{a}}', { ...scopes, local: {}, data: {}, environment: {}, collectionChain: scopes.collectionChain.slice(2) }).text).toBe('collection');
    expect(resolve('{{a}}', { globals: scopes.globals }).text).toBe('global');
  });
  it('resolves nested references and reports missing ones', () => {
    const r = resolve('{{nested}}/{{ missing }}/{{g}}', scopes);
    expect(r.text).toBe('local-B/{{ missing }}/G');
    expect(r.missing).toEqual(['missing']);
  });
  it('generates dynamic variables', () => {
    expect(resolve('{{$guid}}', {}).text).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(resolve('{{$timestamp}}', {}).text)).toBeGreaterThan(1600000000);
    expect(Number(resolve('{{$randomInt}}', {}).text)).toBeLessThanOrEqual(1000);
    expect(resolve('{{$isoTimestamp}}', {}).text).toMatch(/^\d{4}-/);
    expect(resolve('{{$unknownDyn}}', {}).missing).toEqual(['$unknownDyn']);
  });
  it('flattens and lists references', () => {
    expect(flatten(scopes)).toMatchObject({ a: 'local', b: 'B', f: 'F', e: 'E', d: 'D', l: 'L', g: 'G' });
    expect(referencedVariables('{{x}} and {{y}} and {{x}}')).toEqual(['x', 'y']);
    expect(varsFromList([{ key: 'a', value: '1' }, { key: 'b', value: 2 }, { key: 'c', value: 'x', disabled: true }, { key: 'd', value: 'y', enabled: false }, { key: 'e', value: { o: 1 } }])).toEqual({ a: '1', b: '2', e: '{"o":1}' });
  });
});
