// The upload login, kept in localStorage as {v, token, exp}. The token comes from the Apps Script
// and is checked by it on every upload/delete; exp is this device's clock + the ttl the script
// returned (at most 12 hours), so a wrong clock can't make a login last longer.

export const SESSION_KEY = 'files:session:v1';
export const SESSION_MS = 12 * 60 * 60 * 1000;

export type Session = { v: 1; token: string; exp: number };

/** A session from a login reply; null when the reply isn't usable. */
export function sessionFrom(token: unknown, ttl: unknown, now: number): Session | null {
  if (typeof token !== 'string' || !token || typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) return null;
  return { v: 1, token, exp: now + Math.min(ttl, SESSION_MS) };
}

/** Parses a stored session; null when missing, malformed or expired. */
export function readSession(raw: string | null, now: number): Session | null {
  if (typeof raw !== 'string') return null;
  let s: unknown;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || typeof s !== 'object') return null;
  const { v, token, exp } = s as Record<string, unknown>;
  if (v !== 1 || typeof token !== 'string' || !token || typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  // A session can't end more than SESSION_MS from now (edited, or the clock was set back).
  if (exp <= now || exp > now + SESSION_MS) return null;
  return { v: 1, token, exp };
}
