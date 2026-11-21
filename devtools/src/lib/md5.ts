// Small incremental MD5 (RFC 1321). MD5 is broken for security — offered for checksums only.

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;

export class Md5 {
  private h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;
  private w = new Int32Array(16);

  update(data: Uint8Array): this {
    let i = 0;
    this.total += data.length;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = data.length - i;
    }
    return this;
  }

  digest(): Uint8Array {
    const bitLen = this.total * 8;
    const padLen = this.bufLen < 56 ? 56 - this.bufLen : 120 - this.bufLen;
    const pad = new Uint8Array(padLen + 8);
    pad[0] = 0x80;
    const lo = bitLen >>> 0;
    const hi = Math.floor(bitLen / 2 ** 32) >>> 0;
    for (let j = 0; j < 4; j++) {
      pad[padLen + j] = (lo >>> (8 * j)) & 0xff;
      pad[padLen + 4 + j] = (hi >>> (8 * j)) & 0xff;
    }
    this.total -= pad.length; // update() adds it back; keep total meaningful
    this.update(pad);
    const out = new Uint8Array(16);
    for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[j * 4 + k] = (this.h[j] >>> (8 * k)) & 0xff;
    return out;
  }

  private block(d: Uint8Array, off: number) {
    const w = this.w;
    for (let j = 0; j < 16; j++) {
      const o = off + j * 4;
      w[j] = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
    }
    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let dd = this.h[3];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & b) | (~dd & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ dd;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~dd);
        g = (7 * i) & 15;
      }
      const tmp = dd;
      dd = c;
      c = b;
      const x = (a + f + K[i] + w[g]) | 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      a = tmp;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + dd) | 0;
  }
}

export function md5(data: Uint8Array): Uint8Array {
  return new Md5().update(data).digest();
}

export function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  let k = key.length > 64 ? md5(key) : key;
  const block = new Uint8Array(64);
  block.set(k);
  k = block;
  const ipad = k.map((x) => x ^ 0x36);
  const opad = k.map((x) => x ^ 0x5c);
  const inner = new Md5().update(ipad).update(data).digest();
  return new Md5().update(opad).update(inner).digest();
}
