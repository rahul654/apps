import { describe, expect, it } from 'vitest';
import { handlers } from './handlers';

describe('worker handlers', () => {
  it('json formats, sorts, minifies and reports errors', async () => {
    expect(await handlers.json({ text: '{"b":1,"a":2}', indent: 2, sortKeys: true, minify: true, wantValue: false })).toEqual({ ok: true, output: '{"a":2,"b":1}', value: undefined });
    const tree = await handlers.json({ text: '[1]', indent: 4, sortKeys: false, minify: false, wantValue: true });
    expect(tree).toEqual({ ok: true, output: '[\n    1\n]', value: [1] });
    const bad = await handlers.json({ text: '{"a":}', indent: 2, sortKeys: false, minify: false, wantValue: false });
    expect(bad.ok).toBe(false);
  });
  it('jsonDiff returns side errors or entries', async () => {
    expect((await handlers.jsonDiff({ left: '{"a":1}', right: '{"a":2}' })).entries).toHaveLength(1);
    const r = await handlers.jsonDiff({ left: '{', right: '[]' });
    expect(r.leftError?.line).toBe(1);
    expect(r.rightError).toBeUndefined();
  });
  it('hash handles text, files and HMAC keys', async () => {
    const t = await handlers.hash({ text: 'abc' });
    expect(t[0]).toMatchObject({ alg: 'MD5', hex: '900150983cd24fb0d6963f7d28e17f72' });
    const f = await handlers.hash({ file: new Blob(['abc']) });
    expect(f[2].hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const h = await handlers.hash({ text: 'what do ya want for nothing?', hmacKey: { value: '4a656665', encoding: 'hex' } });
    expect(h[0].hex).toBe('750c783e6ab0b503eaa86e310a5db738');
  });
  it('textDiff and regex pass through', async () => {
    expect((await handlers.textDiff({ left: 'a', right: 'b' })).added).toBe(1);
    const r = await handlers.regex({ pattern: 'a', flags: 'g', text: 'aa' });
    expect(r.ok && r.matches.length).toBe(2);
  });
});
