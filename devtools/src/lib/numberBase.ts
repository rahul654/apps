// Arbitrary-precision base conversion with BigInt.

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const PREFIX: Record<number, RegExp> = { 2: /^0b/i, 8: /^0o/i, 16: /^0x/i };

export class BaseError extends Error {}

/** Parse an integer in `base` (2–36). Accepts sign, 0x/0o/0b prefixes, `_`, spaces and commas as separators. */
export function parseBigInt(input: string, base: number): bigint {
  if (base < 2 || base > 36 || !Number.isInteger(base)) throw new BaseError('Base must be between 2 and 36');
  let s = input.trim().replace(/[\s_]/g, '');
  if (base === 10) s = s.replace(/,/g, '');
  let neg = false;
  if (s.startsWith('-') || s.startsWith('+')) {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  if (PREFIX[base]) s = s.replace(PREFIX[base], '');
  if (s === '') throw new BaseError('Enter a number');
  const B = BigInt(base);
  let n = 0n;
  for (const ch of s.toLowerCase()) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) throw new BaseError(`"${ch}" is not a valid base-${base} digit`);
    n = n * B + BigInt(d);
  }
  return neg ? -n : n;
}

export function formatBigInt(n: bigint, base: number, uppercase = false): string {
  const s = n.toString(base);
  return uppercase ? s.toUpperCase() : s;
}

/** Group digits from the right, e.g. groupDigits("11110000", 4) → "1111 0000". */
export function groupDigits(s: string, size: number, sep = ' '): string {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const out: string[] = [];
  for (let end = body.length; end > 0; end -= size) out.unshift(body.slice(Math.max(0, end - size), end));
  return (neg ? '-' : '') + out.join(sep);
}

export function bitLength(n: bigint): number {
  const a = n < 0n ? -n : n;
  return a === 0n ? 0 : a.toString(2).length;
}

/** Two's complement representation of a negative number in `bits` bits (as binary string). */
export function twosComplement(n: bigint, bits: number): string | null {
  const min = -(1n << BigInt(bits - 1));
  const max = (1n << BigInt(bits)) - 1n;
  if (n < min || n > max) return null;
  const v = n < 0n ? (1n << BigInt(bits)) + n : n;
  return v.toString(2).padStart(bits, '0');
}
