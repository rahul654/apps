// Hash and HMAC via WebCrypto (SHA family) plus the local MD5.
import { bytesToBase64 } from './base64';
import { hmacMd5, md5 } from './md5';

export const HASH_ALGS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export type HashAlg = (typeof HASH_ALGS)[number];

export async function digest(alg: HashAlg, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (alg === 'MD5') return md5(data);
  return new Uint8Array(await crypto.subtle.digest(alg, data));
}

export async function hmac(alg: HashAlg, key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (alg === 'MD5') return hmacMd5(key, data);
  // WebCrypto rejects zero-length HMAC keys; RFC 2104 pads the key with zeros anyway.
  const k = await crypto.subtle.importKey('raw', key.length ? key : new Uint8Array(1), { name: 'HMAC', hash: alg }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const h = hex.replace(/\s+/g, '').replace(/^0x/i, '');
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error('Key is not valid hex (needs an even number of 0-9 a-f characters)');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface HashResult {
  alg: HashAlg;
  hex: string;
  base64: string;
}

export async function hashAll(data: Uint8Array<ArrayBuffer>, hmacKey?: Uint8Array<ArrayBuffer>): Promise<HashResult[]> {
  return Promise.all(
    HASH_ALGS.map(async (alg) => {
      const out = hmacKey ? await hmac(alg, hmacKey, data) : await digest(alg, data);
      return { alg, hex: toHex(out), base64: bytesToBase64(out) };
    }),
  );
}
