// Talks to the Apps Script (apps-script/Code.gs). Every call is a POST with a JSON text body:
// text/plain makes it a "simple" request, so the browser sends no CORS preflight (Apps Script
// can't answer OPTIONS). Apps Script answers through a redirect to googleusercontent.com, which
// fetch follows.

export type ErrorCode =
  | 'wrong'
  | 'too-many'
  | 'not-configured'
  | 'expired'
  | 'changed'
  | 'invalid'
  | 'full'
  | 'too-long'
  | 'upload-gone'
  | 'drive'
  | 'not-found'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'no-url';

export const MESSAGES: Record<ErrorCode, string> = {
  wrong: 'That password isn’t right.',
  'too-many': 'Too many wrong passwords. Wait 10 minutes and try again.',
  'not-configured': 'The upload password isn’t set up yet (UPLOAD_PASSWORD in the Apps Script’s Script properties).',
  expired: 'Your hour is up. Enter the password again to keep uploading.',
  changed: 'The upload password was changed. Enter the new one.',
  invalid: 'Please enter the upload password again.',
  full: 'Not enough space left.',
  'too-long': 'That text is too long to save.',
  'upload-gone': 'The upload expired on Google’s side. It will start again.',
  drive: 'Google Drive had a problem. Trying again…',
  'not-found': 'That item doesn’t exist any more.',
  'bad-request': 'Something went wrong. Try again.',
  server: 'The files service had a problem. Try again.',
  network: 'Couldn’t reach the files service. Check your connection.',
  timeout: 'The files service took too long to answer.',
  'no-url': 'This page isn’t connected to its Google Apps Script yet (FILES_URL in src/config.ts).',
};

/** Errors that mean "log in again". */
export const AUTH_ERRORS: ReadonlySet<string> = new Set(['expired', 'changed', 'invalid']);

export type Reply = { ok: boolean; error?: string; [key: string]: unknown };

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly reply: Reply | null;
  constructor(code: string, reply: Reply | null = null) {
    const known = (code in MESSAGES ? code : 'server') as ErrorCode;
    super(MESSAGES[known]);
    this.code = known;
    this.reply = reply;
  }
  get isAuth() {
    return AUTH_ERRORS.has(this.code);
  }
  /** Worth sending again as-is (connection or a passing Google problem). */
  get isTransient() {
    return this.code === 'network' || this.code === 'timeout' || this.code === 'drive' || this.code === 'server';
  }
}

export type CallOptions = {
  url: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/** POSTs one request; resolves with an ok reply, throws ApiError otherwise. */
export async function callScript<T extends object>(body: Record<string, unknown>, { url, timeoutMs = 30_000, signal, fetchImpl = globalThis.fetch }: CallOptions): Promise<T & { ok: true }> {
  if (!url) throw new ApiError('no-url');
  // A timeout plus the caller's signal, without AbortSignal.any/timeout (iOS before 17.4 lacks any).
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let reply: Reply;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    reply = (await res.json()) as Reply;
  } catch (err) {
    if (signal?.aborted) throw err; // the caller cancelled: not an API problem
    throw new ApiError(timedOut ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') throw new ApiError('network');
  if (!reply.ok) throw new ApiError(String(reply.error || 'server'), reply);
  return reply as T & { ok: true };
}
