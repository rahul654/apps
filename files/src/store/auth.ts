// The upload login. Viewing never needs it; uploading, adding text and deleting do.
// - login: the Apps Script checks the password and returns a signed 12-hour token.
// - Every 15 s (and when the tab comes back) the page checks the token's local expiry, and every
//   2 minutes it asks the script whether the token is still good (expired, or password changed).
//   Either way, without reloading: manage controls disappear, and a running upload pauses and
//   asks for the password.
// - The login is shared between tabs through localStorage (`storage` event).
import { ApiError, callScript, MESSAGES } from '../lib/api';
import { SCRIPT_URL } from '../lib/env';
import { readSession, SESSION_KEY, sessionFrom, type Session } from '../lib/session';
import { createStore } from './createStore';

export const LOCAL_CHECK_MS = 15_000;
export const SERVER_CHECK_MS = 120_000;

type AuthState = {
  session: Session | null;
  /** The password dialog: null = closed */
  prompt: { message?: string } | null;
  /** Ticks with the local check, so "52 min left" stays current */
  now: number;
};

function stored(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function store(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the login lasts as long as this page */
  }
}

const storageWorks = (() => {
  try {
    localStorage.setItem(`${SESSION_KEY}:probe`, '1');
    localStorage.removeItem(`${SESSION_KEY}:probe`);
    return true;
  } catch {
    return false;
  }
})();

export const auth = createStore<AuthState>({ session: readSession(stored(), Date.now()), prompt: null, now: Date.now() });

export function openLogin(message?: string) {
  auth.set((s) => ({ ...s, prompt: { message } }));
}

export function closeLogin() {
  auth.set((s) => ({ ...s, prompt: null }));
}

/** @throws ApiError ('wrong', 'too-many', 'network', …) */
export async function login(password: string): Promise<void> {
  const reply = await callScript<{ token: string; ttl: number }>({ action: 'login', password }, { url: SCRIPT_URL });
  const session = sessionFrom(reply.token, reply.ttl, Date.now());
  if (!session) throw new ApiError('bad-request');
  store(session);
  auth.set((s) => ({ ...s, session, prompt: null, now: Date.now() }));
}

export function logout() {
  store(null);
  auth.set((s) => ({ ...s, session: null, prompt: null }));
}

/**
 * Ends the login because the script refused it (or it ran out). Returns the message to show.
 * Only clears storage if it still holds this token (another tab may have logged in again).
 */
export function endSession(code: string): string {
  const message = MESSAGES[code as keyof typeof MESSAGES] ?? MESSAGES.invalid;
  const current = auth.get().session;
  if (current && readSession(stored(), Date.now())?.token === current.token) store(null);
  auth.set((s) => ({ ...s, session: null }));
  return message;
}

/** The token if the login is still valid locally; ends it otherwise. */
export function currentToken(): string | null {
  const s = auth.get().session;
  if (!s) return null;
  if (s.exp <= Date.now()) {
    endSession('expired');
    return null;
  }
  return s.token;
}

/** Local check: expiry, and logins/logouts from other tabs. */
export function recheck() {
  const now = Date.now();
  // localStorage is shared by every tab, so it's the truth when it works; else this page's own copy.
  let next = storageWorks ? readSession(stored(), now) : auth.get().session;
  if (next && next.exp <= now) next = null;
  auth.set((st) => ({ ...st, session: next, now }));
}

/** Asks the script whether the token is still good. Offline: keeps the login. */
export async function verify(): Promise<void> {
  const s = auth.get().session;
  if (!s) return;
  try {
    await callScript({ action: 'check', token: s.token }, { url: SCRIPT_URL });
  } catch (err) {
    if (err instanceof ApiError && err.isAuth && auth.get().session?.token === s.token) endSession(err.code);
  }
}

let watching = false;
/** Starts the periodic checks (once per page). */
export function startAuthWatch() {
  if (watching) return;
  watching = true;
  let lastServerCheck = Date.now();
  const serverCheck = () => {
    lastServerCheck = Date.now();
    void verify();
  };
  if (auth.get().session) serverCheck();
  setInterval(() => {
    recheck();
    if (document.visibilityState === 'visible' && Date.now() - lastServerCheck >= SERVER_CHECK_MS) serverCheck();
  }, LOCAL_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    recheck();
    if (Date.now() - lastServerCheck >= 30_000) serverCheck();
  });
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_KEY || e.key === null) recheck();
  });
}
