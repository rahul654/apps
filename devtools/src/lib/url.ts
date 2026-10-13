// URL encode/decode and parsing helpers.

export type UrlMode = 'component' | 'uri';

export function urlEncode(text: string, mode: UrlMode, spaceAsPlus = false): string {
  const out = mode === 'component' ? encodeURIComponent(text) : encodeURI(text);
  return spaceAsPlus ? out.replace(/%20/g, '+') : out;
}

/** Throws URIError with a friendlier message on malformed escapes. */
export function urlDecode(text: string, mode: UrlMode, plusAsSpace = false): string {
  const src = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return mode === 'component' ? decodeURIComponent(src) : decodeURI(src);
  } catch {
    const bad = /%(?![0-9a-fA-F]{2})/.exec(src);
    const where = bad ? ` near position ${bad.index + 1}` : '';
    throw new URIError(`Malformed percent-encoding${where} (expected %XX with valid UTF-8 bytes)`);
  }
}

export interface ParsedUrl {
  href: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  params: [string, string][];
  /** True when "https://" was prepended because the input had no scheme. */
  assumedScheme: boolean;
}

export function parseUrl(input: string): ParsedUrl {
  const trimmed = input.trim();
  let assumedScheme = false;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    // Allow "example.com/path?x=1" by assuming https.
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(trimmed) || /^localhost(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) {
      u = new URL(`https://${trimmed}`);
      assumedScheme = true;
    } else {
      throw new TypeError('Not a valid absolute URL (include the scheme, e.g. https://)');
    }
  }
  return {
    href: u.href,
    protocol: u.protocol,
    username: u.username,
    password: u.password,
    host: u.host,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    origin: u.origin,
    params: [...u.searchParams.entries()],
    assumedScheme,
  };
}

/** Replace the query string of `href` with `params` (keeps the fragment). */
export function withParams(href: string, params: [string, string][]): string {
  const u = new URL(href);
  const sp = new URLSearchParams();
  for (const [k, v] of params) sp.append(k, v);
  u.search = sp.toString();
  return u.href;
}
