// Password gate: browser-side helpers shared by auth-gate.js and the tests. No DOM.
//
// The password is checked by a Google Apps Script web app (gate/apps-script.gs), never in the
// page. A correct password returns a signed token; the page keeps {v, token, exp} in localStorage
// and asks the script to check the token on every page load. exp is worked out from the ttl the
// script returns and this device's clock, so a wrong clock can't make a login last longer.

export const SESSION_KEY = 'apps:gate:v2';
export const OLD_SESSION_KEYS = ['apps:gate:v1'];
export const SESSION_MS = 60 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15_000; // Apps Script can take a few seconds to wake up

/** What each error from the script (or the network) means to the person at the lock screen. */
export const MESSAGES = {
  wrong: 'That password isn’t right.',
  'too-many': 'Too many wrong passwords. Wait 10 minutes and try again.',
  'not-configured': 'The password isn’t set up yet (PASSWORD in the Apps Script’s Script properties).',
  'no-url': 'The login service isn’t set up yet (GATE_URL in gate/config.js).',
  network: 'Couldn’t reach the login service. Check your connection and try again.',
  expired: 'Your hour is up. Enter the password again.',
  changed: 'The password was changed. Enter the new one.',
  invalid: 'Please sign in again.',
  'bad-request': 'Something went wrong. Try again.',
};

export class GateError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES['bad-request']);
    this.code = code;
  }
}

/**
 * POSTs one request to the Apps Script and returns its JSON reply.
 * The body goes as text/plain: a "simple" request, so there's no CORS preflight (Apps Script
 * can't answer OPTIONS). Throws GateError('network') when there's no usable reply.
 */
export async function callGate(url, body, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!url) throw new GateError('no-url');
  let reply;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    reply = await res.json();
  } catch {
    throw new GateError('network');
  }
  if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') throw new GateError('network');
  return reply;
}

/** A session from a login reply; null when the reply isn't usable. */
export function sessionFrom(token, ttl, now) {
  if (typeof token !== 'string' || !token || !Number.isFinite(ttl) || ttl <= 0) return null;
  return { v: 2, token, exp: now + Math.min(ttl, SESSION_MS) };
}

/** Parses a stored session; null when missing, malformed or expired. */
export function readSession(raw, now) {
  if (typeof raw !== 'string') return null;
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || s.v !== 2 || typeof s.token !== 'string' || !s.token || !Number.isFinite(s.exp)) return null;
  // A session can't end more than SESSION_MS from now (edited, or the clock was set back).
  if (s.exp <= now || s.exp > now + SESSION_MS) return null;
  return { v: 2, token: s.token, exp: s.exp };
}
