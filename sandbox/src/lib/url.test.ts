import { describe, expect, it } from 'vitest';
import { hostOf, normalizeUrl, originOf } from './url';

const ok = (input: string) => {
  const r = normalizeUrl(input);
  if (!r.ok) throw new Error(`expected ok for ${input}: ${r.error}`);
  return r.url;
};

describe('normalizeUrl', () => {
  it('adds https:// to bare domains', () => {
    expect(ok('example.com')).toBe('https://example.com/');
    expect(ok('  en.wikipedia.org/wiki/Sandbox  ')).toBe('https://en.wikipedia.org/wiki/Sandbox');
    expect(ok('example.com?q=1#top')).toBe('https://example.com/?q=1#top');
    expect(ok('//cdn.example.com/x')).toBe('https://cdn.example.com/x');
  });

  it('uses http:// for local and intranet hosts', () => {
    expect(ok('localhost:5173')).toBe('http://localhost:5173/');
    expect(ok('localhost')).toBe('http://localhost/');
    expect(ok('127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app');
    expect(ok('192.168.1.20')).toBe('http://192.168.1.20/');
    expect(ok('devbox:3000')).toBe('http://devbox:3000/');
  });

  it('keeps explicit http and https', () => {
    expect(ok('http://example.com')).toBe('http://example.com/');
    expect(ok('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('refuses other schemes', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com', 'mailto:a@b.co', 'javascript://%0aalert(1)']) {
      const r = normalizeUrl(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/http/);
    }
  });

  it('refuses things that are not addresses', () => {
    for (const bad of ['', '   ', 'hello world', 'justaword', 'https://']) {
      expect(normalizeUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe('hostOf / originOf', () => {
  it('extracts parts and tolerates junk', () => {
    expect(hostOf('https://www.example.com:8443/a')).toBe('www.example.com:8443');
    expect(originOf('https://www.example.com:8443/a')).toBe('https://www.example.com:8443');
    expect(hostOf('nope')).toBe('');
    expect(originOf('')).toBe('');
  });
});
