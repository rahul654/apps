// JWT decoding (no verification) and optional HMAC (HS256/384/512) verification via WebCrypto.
import { base64ToBytes, bytesToBase64, utf8DecodeStrict, utf8Encode } from './base64';
import { formatDuration } from './time';

export class JwtError extends Error {}

export interface DecodedJwt {
  header: Record<string, unknown>;
  /** Parsed payload, or null when the payload is not JSON. */
  payload: Record<string, unknown> | null;
  payloadText: string;
  signature: string;
  parts: [string, string, string];
}

function decodeSegment(seg: string, name: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(seg)) throw new JwtError(`The ${name} is not valid base64url`);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(seg);
  } catch {
    throw new JwtError(`The ${name} is not valid base64url`);
  }
  const text = utf8DecodeStrict(bytes);
  if (text === null) throw new JwtError(`The ${name} is not valid UTF-8`);
  return text;
}

export function decodeJwt(token: string): DecodedJwt {
  const t = token.trim().replace(/^Bearer\s+/i, '');
  if (t === '') throw new JwtError('Paste a JWT');
  const parts = t.split('.');
  if (parts.length === 5) throw new JwtError('This looks like an encrypted JWT (JWE, 5 parts). Its payload cannot be read without the decryption key.');
  if (parts.length !== 3) throw new JwtError(`A JWT has 3 dot-separated parts; found ${parts.length}`);
  const headerText = decodeSegment(parts[0], 'header');
  let header: unknown;
  try {
    header = JSON.parse(headerText);
  } catch {
    throw new JwtError('The header is not valid JSON');
  }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) throw new JwtError('The header must be a JSON object');
  const payloadText = decodeSegment(parts[1], 'payload');
  let payload: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(payloadText);
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) payload = p;
  } catch {
    payload = null;
  }
  return { header: header as Record<string, unknown>, payload, payloadText, signature: parts[2], parts: parts as [string, string, string] };
}

export interface ClaimTime {
  claim: 'exp' | 'nbf' | 'iat';
  label: string;
  seconds: number;
  ms: number;
}

const CLAIM_LABELS = { exp: 'Expires', nbf: 'Not before', iat: 'Issued at' } as const;

export function timeClaims(payload: Record<string, unknown> | null): ClaimTime[] {
  if (!payload) return [];
  const out: ClaimTime[] = [];
  for (const claim of ['iat', 'nbf', 'exp'] as const) {
    const v = payload[claim];
    if (typeof v === 'number' && Number.isFinite(v)) out.push({ claim, label: CLAIM_LABELS[claim], seconds: v, ms: v * 1000 });
  }
  return out;
}

export type JwtStatus = { state: 'valid' | 'expired' | 'not-yet-valid' | 'no-expiry'; message: string };

export function jwtStatus(payload: Record<string, unknown> | null, nowMs: number): JwtStatus {
  const exp = typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
  const nbf = typeof payload?.nbf === 'number' ? payload.nbf * 1000 : null;
  if (nbf !== null && nowMs < nbf) return { state: 'not-yet-valid', message: `Not valid yet — becomes valid in ${formatDuration(nbf - nowMs)}` };
  if (exp === null) return { state: 'no-expiry', message: 'No expiry (no exp claim)' };
  if (nowMs >= exp) return { state: 'expired', message: `Expired ${formatDuration(nowMs - exp)} ago` };
  return { state: 'valid', message: `Not expired — valid for ${formatDuration(exp - nowMs)}` };
}

export const HMAC_ALGS = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' } as const;
export type HmacAlg = keyof typeof HMAC_ALGS;

export const isHmacAlg = (alg: unknown): alg is HmacAlg => typeof alg === 'string' && alg in HMAC_ALGS;

export type SecretEncoding = 'utf8' | 'base64';

export function secretBytes(secret: string, encoding: SecretEncoding): Uint8Array<ArrayBuffer> {
  return encoding === 'base64' ? base64ToBytes(secret) : utf8Encode(secret);
}

async function hmac(alg: HmacAlg, key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: HMAC_ALGS[alg] }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8Encode(data)));
}

/** Verify an HS256/384/512 signature. Throws JwtError for unsupported algorithms. */
export async function verifyHmacJwt(token: string, key: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const { header, parts } = decodeJwt(token);
  const alg = header.alg;
  if (!isHmacAlg(alg)) throw new JwtError(`Signature verification here supports HS256, HS384 and HS512 only (token uses ${String(alg)})`);
  if (key.length === 0) throw new JwtError('Enter the secret');
  const expected = bytesToBase64(await hmac(alg, key, `${parts[0]}.${parts[1]}`), true);
  // Compare without early exit.
  const actual = parts[2];
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

/** Create a signed HMAC JWT (used for the sample token and tests). */
export async function signHmacJwt(payload: Record<string, unknown>, key: Uint8Array<ArrayBuffer>, alg: HmacAlg = 'HS256'): Promise<string> {
  const enc = (o: unknown) => bytesToBase64(utf8Encode(JSON.stringify(o)), true);
  const input = `${enc({ alg, typ: 'JWT' })}.${enc(payload)}`;
  return `${input}.${bytesToBase64(await hmac(alg, key, input), true)}`;
}
