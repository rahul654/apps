export type ParsedUrl = { ok: true; url: string } | { ok: false; error: string };

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// Anything that looks like "host[:port][/path…]" without a scheme.
const BARE = /^([^\s/?#:]+|\[[0-9a-f:.]+\])(:\d{1,5})?([/?#].*)?$/i;

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOST.test(hostname);
}

/**
 * Turns what someone types into the address bar into an http(s) URL.
 * "example.com" → https://example.com/, "localhost:5173" → http://localhost:5173/.
 * Other schemes (javascript:, data:, file:…) are refused.
 */
export function normalizeUrl(input: string): ParsedUrl {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter a web address.' };
  if (/\s/.test(text)) return { ok: false, error: 'That doesn’t look like a web address. Try something like example.com.' };

  let candidate = text;
  if (text.startsWith('//')) candidate = `https:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const bare = BARE.exec(text);
    const host = bare?.[1] ?? '';
    const hasPort = Boolean(bare?.[2]);
    if (bare && (isLocalHost(host) || IPV4.test(host) || (hasPort && !host.includes('.')))) {
      candidate = `http://${text}`; // local dev servers and intranet hosts rarely have TLS
    } else if (bare && host.includes('.')) {
      candidate = `https://${text}`;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      return { ok: false, error: 'Only http:// and https:// addresses can be opened.' };
    } else {
      return { ok: false, error: 'That doesn’t look like a web address. Try something like example.com.' };
    }
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'That doesn’t look like a web address. Try something like example.com.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// addresses can be opened.' };
  }
  if (!url.hostname) return { ok: false, error: 'The address is missing a host name.' };
  return { ok: true, url: url.href };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
