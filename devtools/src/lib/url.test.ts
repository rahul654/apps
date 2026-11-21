import { describe, expect, it } from 'vitest';
import { parseUrl, urlDecode, urlEncode, withParams } from './url';

describe('url encode/decode', () => {
  it('component vs full URI', () => {
    const s = 'https://x.com/a b?q=1&r=ü#h';
    expect(urlEncode(s, 'component')).toBe('https%3A%2F%2Fx.com%2Fa%20b%3Fq%3D1%26r%3D%C3%BC%23h');
    expect(urlEncode(s, 'uri')).toBe('https://x.com/a%20b?q=1&r=%C3%BC#h');
    expect(urlEncode('a b', 'component', true)).toBe('a+b');
  });
  it('decodes and reports malformed input', () => {
    expect(urlDecode('a%20b%F0%9F%91%8B', 'component')).toBe('a b👋');
    expect(urlDecode('a+b', 'component', true)).toBe('a b');
    expect(() => urlDecode('100%', 'component')).toThrow(/Malformed/);
    expect(() => urlDecode('%E0%A4%A', 'component')).toThrow(URIError);
  });
});

describe('parseUrl', () => {
  it('splits a URL into parts and params', () => {
    const p = parseUrl('https://user:pw@example.com:8080/p/a/t/h?query=string&x=1&x=2#frag');
    expect(p).toMatchObject({ protocol: 'https:', username: 'user', password: 'pw', hostname: 'example.com', port: '8080', pathname: '/p/a/t/h', hash: '#frag', assumedScheme: false });
    expect(p.params).toEqual([
      ['query', 'string'],
      ['x', '1'],
      ['x', '2'],
    ]);
  });
  it('assumes https for bare hosts and rejects junk', () => {
    expect(parseUrl('example.com/a?b=c')).toMatchObject({ href: 'https://example.com/a?b=c', assumedScheme: true });
    expect(() => parseUrl('not a url')).toThrow();
  });
  it('rebuilds a URL from edited params, keeping the hash', () => {
    expect(withParams('https://e.com/p?a=1#top', [['a', '2'], ['b c', 'd&e']])).toBe('https://e.com/p?a=2&b+c=d%26e#top');
    expect(withParams('https://e.com/p?a=1', [])).toBe('https://e.com/p');
  });
});
