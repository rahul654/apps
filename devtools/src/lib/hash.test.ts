import { describe, expect, it } from 'vitest';
import { utf8Encode } from './base64';
import { digest, hashAll, hexToBytes, hmac, toHex } from './hash';
import { Md5, md5 } from './md5';

const hex = async (alg: Parameters<typeof digest>[0], s: string) => toHex(await digest(alg, utf8Encode(s)));

describe('MD5 (RFC 1321 test suite)', () => {
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
  ];
  it.each(vectors)('md5(%j)', (input, expected) => {
    expect(toHex(md5(utf8Encode(input)))).toBe(expected);
  });
  it('is the same when fed incrementally in odd chunks', () => {
    const data = utf8Encode('x'.repeat(1000) + 'ü'.repeat(77));
    const h = new Md5();
    for (let i = 0; i < data.length; i += 37) h.update(data.subarray(i, i + 37));
    expect(toHex(h.digest())).toBe(toHex(md5(data)));
  });
});

describe('SHA family (WebCrypto)', () => {
  it('matches FIPS 180 "abc" vectors', async () => {
    expect(await hex('SHA-1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await hex('SHA-256', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hex('SHA-384', 'abc')).toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
    expect(await hex('SHA-512', 'abc')).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  });
  it('hashAll returns hex and base64 for every algorithm', async () => {
    const r = await hashAll(utf8Encode(''));
    expect(r.map((x) => x.alg)).toEqual(['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);
    expect(r[2]).toEqual({ alg: 'SHA-256', hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', base64: '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' });
  });
});

describe('HMAC (RFC 2104 / RFC 4231 "Jefe" vectors)', () => {
  const key = utf8Encode('Jefe');
  const data = utf8Encode('what do ya want for nothing?');
  it('HMAC-MD5', async () => {
    expect(toHex(await hmac('MD5', key, data))).toBe('750c783e6ab0b503eaa86e310a5db738');
  });
  it('HMAC-SHA-256 / SHA-512', async () => {
    expect(toHex(await hmac('SHA-256', key, data))).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(toHex(await hmac('SHA-512', key, data))).toBe('164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737');
  });
  it('HMAC-SHA-256 with an empty key equals RFC 2104 zero padding', async () => {
    const a = toHex(await hmac('SHA-256', new Uint8Array(0), data));
    const b = toHex(await hmac('SHA-256', new Uint8Array(64), data));
    expect(a).toBe(b);
  });
  it('hexToBytes', () => {
    expect([...hexToBytes('0x0aFF')]).toEqual([10, 255]);
    expect(() => hexToBytes('abc')).toThrow();
  });
});
