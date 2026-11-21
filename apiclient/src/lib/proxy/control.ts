import { pingProxy } from '../request/send';

/**
 * Starting the proxy goes through the `apiclient-proxy://` link type registered by
 * proxy/install-launcher.sh: a web page can't start programs itself. Stopping uses the proxy's
 * own POST /shutdown, which only answers allowed origins.
 */
export const START_LINK = 'apiclient-proxy://start';

/** Opens the launcher link. Must run inside a click handler: browsers only open external links on a user gesture. */
export function openStartLink(): void {
  window.location.assign(START_LINK);
}

export async function stopProxy(proxyUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/shutdown`, { method: 'POST', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Polls /ping until the proxy is up (or down), the timeout passes, or `signal` aborts. Resolves to whether it got there. */
export async function waitForProxy(proxyUrl: string, want: 'up' | 'down', timeoutMs: number, signal?: AbortSignal, intervalMs = 400): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return false;
    const { ok } = await pingProxy(proxyUrl, signal);
    if (ok === (want === 'up')) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Absolute URL of a file shipped next to the app (the installer and proxy script). */
export function appFileUrl(name: string): string {
  return new URL(`./${name}`, window.location.href).href;
}

/** The app's base URL without a trailing slash, as the installer's APICLIENT_URL expects. */
export function appBaseUrl(): string {
  return appFileUrl('').replace(/\/$/, '');
}

export const DEFAULT_PROXY_PORT = 4399;

/** A TCP port the proxy can listen on: 1024–65535 (lower ports need root). */
export function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1024 && n <= 65535 ? n : null;
}

/** The port in a saved proxy URL, falling back to the default. */
export function portFromUrl(url: string): number {
  try {
    const u = new URL(url);
    return parsePort(u.port) ?? DEFAULT_PROXY_PORT;
  } catch {
    return DEFAULT_PROXY_PORT;
  }
}

export const proxyUrlForPort = (port: number) => `http://localhost:${port}`;

export type CommandOs = 'unix' | 'windows';

export function guessOs(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): CommandOs {
  return /Windows/i.test(userAgent) ? 'windows' : 'unix';
}

/**
 * One line that downloads the latest proxy to a temp folder and runs it. Running it again
 * replaces a proxy already on that port (the script handles the takeover).
 * `allow` is added only when the app is served from an origin outside the proxy's defaults.
 */
export function proxyCommand({ os, port, scriptUrl, allow }: { os: CommandOs; port: number; scriptUrl: string; allow?: string }): string {
  const args = `--port ${port}${allow ? ` --allow ${allow}` : ''}`;
  if (os === 'windows') {
    const file = '"$env:TEMP\\apiclient-proxy.mjs"';
    return `iwr ${scriptUrl} -OutFile ${file}; node ${file} ${args}`;
  }
  return `curl -fsSL ${scriptUrl} -o /tmp/apiclient-proxy.mjs && node /tmp/apiclient-proxy.mjs ${args}`;
}

/** Origins the proxy allows without --allow (keep in sync with proxy/apiclient-proxy.mjs). */
export function allowedByDefault(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'https://rahul654.github.io';
}
