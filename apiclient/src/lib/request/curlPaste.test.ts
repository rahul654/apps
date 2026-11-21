import { describe, expect, it } from 'vitest';
import { curlImportSummary, looksLikeCurl, mergeCurlRequest, parseCurlPaste } from './curlPaste';

// Shape of Chrome DevTools → Copy → "Copy as cURL (bash)".
const CHROME = `curl 'https://api.example.com/v1/orders?status=open&page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer eyJhbGciOi.abc.def' \\
  -H 'content-type: application/json' \\
  --data-raw '{"items":[{"sku":"A-1","qty":2}],"note":"it'\\''s fine"}'`;

describe('cURL paste', () => {
  it('recognises commands, not URLs or text that mentions curl', () => {
    expect(looksLikeCurl(CHROME)).toBe(true);
    expect(looksLikeCurl('  $ curl https://x.dev')).toBe(true);
    expect(looksLikeCurl('curl.exe -X POST https://x.dev')).toBe(true);
    expect(looksLikeCurl('https://x.dev/curl')).toBe(false);
    expect(looksLikeCurl('curly braces')).toBe(false);
    expect(looksLikeCurl('curl')).toBe(false);
  });

  it('imports a multi-line Chrome command: method, URL, query, headers and JSON body', () => {
    const r = parseCurlPaste(CHROME);
    expect(r.method).toBe('POST');
    const url = r.url as { raw: string; query?: { key: string; value: string }[] };
    expect(url.raw).toBe('https://api.example.com/v1/orders?status=open&page=2');
    expect(url.query).toEqual([{ key: 'status', value: 'open' }, { key: 'page', value: '2' }]);
    expect((r.header as { key: string }[]).map((h) => h.key)).toEqual(['accept', 'authorization', 'content-type']);
    expect(r.body).toEqual({ mode: 'raw', raw: '{"items":[{"sku":"A-1","qty":2}],"note":"it\'s fine"}', options: { raw: { language: 'json' } } });
  });

  it('accepts a $ prompt and curl.exe', () => {
    expect(parseCurlPaste('$ curl -X DELETE https://x.dev/a/1').method).toBe('DELETE');
    expect(parseCurlPaste('curl.exe https://x.dev/ping').method).toBe('GET');
  });

  it('throws a readable error when there is no URL', () => {
    expect(() => parseCurlPaste('curl -H "a: b"')).toThrow(/No URL/);
  });

  it('keeps the description; own credentials replace inherited auth, none means inherit', () => {
    const current = { method: 'GET', url: 'https://old', description: 'Docs stay', auth: { type: 'bearer' as const, bearer: [] } };
    const withAuthHeader = mergeCurlRequest(current, parseCurlPaste(CHROME));
    expect(withAuthHeader.description).toBe('Docs stay');
    expect(withAuthHeader.auth).toEqual({ type: 'noauth' });
    const basic = mergeCurlRequest(current, parseCurlPaste('curl -u me:secret https://x.dev'));
    expect(basic.auth?.type).toBe('basic');
    const plain = mergeCurlRequest(current, parseCurlPaste('curl https://x.dev'));
    expect(plain.auth).toBeUndefined();
  });

  it('summarises what was imported', () => {
    expect(curlImportSummary(parseCurlPaste(CHROME))).toBe('Imported cURL: POST with 3 headers and a JSON body.');
    expect(curlImportSummary(parseCurlPaste('curl https://x.dev'))).toBe('Imported cURL: GET with 0 headers.');
    expect(curlImportSummary(parseCurlPaste('curl -u a:b -H "x: 1" https://x.dev'))).toBe('Imported cURL: GET with 1 header and Basic auth.');
  });
});
