import { describe, expect, it } from 'vitest';
import { allowedByDefault, DEFAULT_PROXY_PORT, guessOs, parsePort, portFromUrl, proxyCommand, proxyUrlForPort } from './control';

const SCRIPT = 'https://rahul654.github.io/apps/apiclient/apiclient-proxy.mjs';

describe('proxy port helpers', () => {
  it('accepts unprivileged ports only', () => {
    expect(parsePort('4399')).toBe(4399);
    expect(parsePort(' 8080 ')).toBe(8080);
    for (const bad of ['', 'abc', '80', '1023', '65536', '43.9', '-1', '123456']) expect(parsePort(bad), bad).toBeNull();
  });

  it('reads the port from a saved URL, with the default as fallback', () => {
    expect(portFromUrl('http://localhost:4400')).toBe(4400);
    expect(portFromUrl('http://localhost')).toBe(DEFAULT_PROXY_PORT);
    expect(portFromUrl('not a url')).toBe(DEFAULT_PROXY_PORT);
    expect(proxyUrlForPort(4401)).toBe('http://localhost:4401');
  });
});

describe('proxyCommand', () => {
  it('downloads to a temp file and runs it on the chosen port (macOS/Linux)', () => {
    expect(proxyCommand({ os: 'unix', port: 4399, scriptUrl: SCRIPT })).toBe(
      `curl -fsSL ${SCRIPT} -o /tmp/apiclient-proxy.mjs && node /tmp/apiclient-proxy.mjs --port 4399`,
    );
  });

  it('uses PowerShell on Windows', () => {
    expect(proxyCommand({ os: 'windows', port: 4500, scriptUrl: SCRIPT })).toBe(
      `iwr ${SCRIPT} -OutFile "$env:TEMP\\apiclient-proxy.mjs"; node "$env:TEMP\\apiclient-proxy.mjs" --port 4500`,
    );
  });

  it('adds --allow for origins outside the defaults', () => {
    expect(proxyCommand({ os: 'unix', port: 4399, scriptUrl: SCRIPT, allow: 'https://example.org' })).toMatch(/--port 4399 --allow https:\/\/example\.org$/);
    expect(allowedByDefault('https://rahul654.github.io')).toBe(true);
    expect(allowedByDefault('http://localhost:5173')).toBe(true);
    expect(allowedByDefault('https://example.org')).toBe(false);
  });

  it('guesses the OS from the user agent', () => {
    expect(guessOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(guessOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('unix');
    expect(guessOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('unix');
  });
});
