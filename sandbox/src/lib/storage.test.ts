import { describe, expect, it } from 'vitest';
import { createSandbox, duplicateSandbox } from './defaults';
import { normalizeSandbox, parseData } from './storage';

describe('parseData', () => {
  it('round-trips sandboxes', () => {
    const web = createSandbox('web', { url: 'https://example.com/' });
    const html = createSandbox('html');
    const data = parseData(JSON.stringify({ version: 1, sandboxes: [web, html] }));
    expect(data.sandboxes).toEqual([web, html]);
  });

  it('returns empty data for missing, corrupt or future data', () => {
    expect(parseData(null).sandboxes).toEqual([]);
    expect(parseData('{oops').sandboxes).toEqual([]);
    expect(parseData(JSON.stringify({ version: 2, sandboxes: [] })).sandboxes).toEqual([]);
    expect(parseData(JSON.stringify([1, 2])).sandboxes).toEqual([]);
  });

  it('skips invalid entries and duplicate ids', () => {
    const a = createSandbox('web', { url: 'https://a.example/' });
    const data = parseData(JSON.stringify({ version: 1, sandboxes: [a, { ...a, name: 'dupe' }, { id: 'x', kind: 'weird' }, null, 'str'] }));
    expect(data.sandboxes.map((s) => s.name)).toEqual([a.name]);
  });
});

describe('normalizeSandbox', () => {
  it('fills defaults and strips unsafe or unknown values', () => {
    const sb = normalizeSandbox({
      id: 'x',
      kind: 'web',
      url: 'javascript:alert(1)',
      tokens: ['allow-scripts', 'allow-top-navigation', 42],
      features: ['camera', 'usb'],
      referrer: 'unsafe-url',
      viewport: { preset: 'nope', width: 5 },
    })!;
    expect(sb.url).toBe('');
    expect(sb.tokens).toEqual(['allow-scripts']);
    expect(sb.features).toEqual(['camera']);
    expect(sb.referrer).toBe('no-referrer');
    expect(sb.viewport.preset).toBe('fill');
    expect(sb.viewport.width).toBe(120);
    expect(sb.name).toBe('New sandbox');
  });
});

describe('createSandbox / duplicateSandbox', () => {
  it('names web sandboxes after the host and isolates HTML ones', () => {
    expect(createSandbox('web', { url: 'https://www.example.com/x' }).name).toBe('example.com');
    const html = createSandbox('html');
    expect(html.tokens).not.toContain('allow-same-origin');
    expect(html.credentialless).toBe(false);
    expect(html.html).toContain('<!doctype html>');
  });

  it('duplicates with a new id and an independent viewport', () => {
    const a = createSandbox('web', { url: 'https://example.com/' });
    const b = duplicateSandbox(a);
    expect(b.id).not.toBe(a.id);
    expect(b.name).toBe('example.com (copy)');
    b.viewport.width = 999;
    expect(a.viewport.width).not.toBe(999);
  });
});
