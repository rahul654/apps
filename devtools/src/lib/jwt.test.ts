import { describe, expect, it } from 'vitest';
import { utf8Encode } from './base64';
import { decodeJwt, jwtStatus, signHmacJwt, timeClaims, verifyHmacJwt } from './jwt';

// The well-known example token from jwt.io (secret "your-256-bit-secret").
const JWT_IO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('decodeJwt', () => {
  it('decodes header and payload', () => {
    const d = decodeJwt(JWT_IO);
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(d.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });
  it('accepts a Bearer prefix and whitespace', () => {
    expect(decodeJwt(`  Bearer ${JWT_IO}\n`).payload?.name).toBe('John Doe');
  });
  it('rejects malformed tokens with a clear message', () => {
    expect(() => decodeJwt('abc')).toThrow(/3 dot-separated parts/);
    expect(() => decodeJwt('a.b.c.d.e')).toThrow(/JWE/);
    expect(() => decodeJwt('e30.@@@.x')).toThrow(/payload is not valid base64url/);
    expect(() => decodeJwt('bm9wZQ.e30.x')).toThrow(/header is not valid JSON/);
  });
  it('keeps non-JSON payloads as text', () => {
    const d = decodeJwt('eyJhbGciOiJub25lIn0.aGVsbG8.');
    expect(d.payload).toBeNull();
    expect(d.payloadText).toBe('hello');
  });
});

describe('verifyHmacJwt', () => {
  it('verifies the jwt.io HS256 vector', async () => {
    expect(await verifyHmacJwt(JWT_IO, utf8Encode('your-256-bit-secret'))).toBe(true);
    expect(await verifyHmacJwt(JWT_IO, utf8Encode('wrong-secret'))).toBe(false);
  });
  it('round-trips HS384 and HS512 via signHmacJwt', async () => {
    for (const alg of ['HS256', 'HS384', 'HS512'] as const) {
      const key = utf8Encode('s3cret');
      const t = await signHmacJwt({ sub: 'x' }, key, alg);
      expect(decodeJwt(t).header.alg).toBe(alg);
      expect(await verifyHmacJwt(t, key)).toBe(true);
      expect(await verifyHmacJwt(t.slice(0, -2) + 'AA', key)).toBe(false);
    }
  });
  it('refuses unsupported algorithms', async () => {
    const rs = 'eyJhbGciOiJSUzI1NiJ9.e30.c2ln';
    await expect(verifyHmacJwt(rs, utf8Encode('k'))).rejects.toThrow(/HS256, HS384 and HS512 only/);
  });
});

describe('claims & status', () => {
  const now = 1_700_000_000_000;
  it('extracts time claims', () => {
    expect(timeClaims({ iat: 1, exp: 2, foo: 3 }).map((c) => c.claim)).toEqual(['iat', 'exp']);
  });
  it('computes expired / valid / not-yet-valid', () => {
    expect(jwtStatus({ exp: now / 1000 - 3600 }, now)).toEqual({ state: 'expired', message: 'Expired 1h ago' });
    expect(jwtStatus({ exp: now / 1000 + 90061 }, now)).toEqual({ state: 'valid', message: 'Not expired — valid for 1d 1h' });
    expect(jwtStatus({ nbf: now / 1000 + 60, exp: now / 1000 + 120 }, now).state).toBe('not-yet-valid');
    expect(jwtStatus({}, now).state).toBe('no-expiry');
  });
});
