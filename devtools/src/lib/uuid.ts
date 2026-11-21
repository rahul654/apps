// UUID v4 / v7 generation (RFC 9562) and inspection.

export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => void;

const defaultRandom: RandomFill = (b) => {
  crypto.getRandomValues(b);
};

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function bytesToUuid(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += HEX[b[i]];
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-';
  }
  return s;
}

export function uuidv4(random: RandomFill = defaultRandom): string {
  const b = new Uint8Array(16);
  random(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToUuid(b);
}

/**
 * UUID v7 generator: 48-bit Unix ms timestamp, then 12-bit `rand_a` used as a monotonic
 * counter within the same millisecond (RFC 9562 §6.2 method 1), then 62 random bits.
 * IDs from one generator therefore sort in creation order even when made in the same ms.
 */
export function createUuidV7Generator(now: () => number = Date.now, random: RandomFill = defaultRandom): () => string {
  let lastMs = -1;
  let counter = 0;
  const b = new Uint8Array(16);
  return () => {
    let ms = Math.max(Math.floor(now()), 0);
    random(b);
    if (ms > lastMs) {
      // Random start, top bit clear, leaving headroom for increments within this ms.
      counter = ((b[6] << 8) | b[7]) & 0x7ff;
      lastMs = ms;
    } else {
      ms = lastMs; // same ms or the clock went backwards: keep ordering
      counter++;
      if (counter > 0xfff) {
        lastMs = ++ms; // counter overflow: borrow the next millisecond
        counter = 0;
      }
    }
    // 48-bit big-endian timestamp (2**32 split keeps it exact without BigInt).
    const hi = Math.floor(ms / 2 ** 32);
    const lo = ms >>> 0;
    b[0] = (hi >>> 8) & 0xff;
    b[1] = hi & 0xff;
    b[2] = (lo >>> 24) & 0xff;
    b[3] = (lo >>> 16) & 0xff;
    b[4] = (lo >>> 8) & 0xff;
    b[5] = lo & 0xff;
    b[6] = 0x70 | ((counter >>> 8) & 0x0f);
    b[7] = counter & 0xff;
    b[8] = (b[8] & 0x3f) | 0x80;
    return bytesToUuid(b);
  };
}

const sharedV7 = createUuidV7Generator();
export const uuidv7 = (): string => sharedV7();

export interface UuidFormat {
  uppercase: boolean;
  hyphens: boolean;
}

export function formatUuid(u: string, f: UuidFormat): string {
  let s = f.hyphens ? u : u.replace(/-/g, '');
  if (f.uppercase) s = s.toUpperCase();
  return s;
}

export interface UuidInfo {
  normalized: string;
  version: number;
  versionName: string;
  variant: string;
  /** Embedded creation time for v1, v6 and v7. */
  timestampMs?: number;
  special?: 'nil' | 'max';
}

const VERSION_NAMES: Record<number, string> = {
  1: 'Time-based (Gregorian, MAC)',
  2: 'DCE Security',
  3: 'Name-based (MD5)',
  4: 'Random',
  5: 'Name-based (SHA-1)',
  6: 'Reordered time-based',
  7: 'Unix time-ordered',
  8: 'Custom / vendor-specific',
};

const GREGORIAN_OFFSET_100NS = 122192928000000000n; // 1582-10-15 → 1970-01-01

/** Parse a UUID in any common form (hyphens optional, braces, urn:uuid:). Returns null if invalid. */
export function inspectUuid(input: string): UuidInfo | null {
  const s = input
    .trim()
    .replace(/^urn:uuid:/i, '')
    .replace(/^\{(.*)\}$/, '$1');
  const m = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i.exec(s);
  if (!m) return null;
  const hex = m.slice(1).join('').toLowerCase();
  const normalized = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (/^0+$/.test(hex)) return { normalized, version: 0, versionName: 'Nil UUID', variant: '—', special: 'nil' };
  if (/^f+$/.test(hex)) return { normalized, version: 15, versionName: 'Max UUID', variant: '—', special: 'max' };
  const version = parseInt(hex[12], 16);
  const v = parseInt(hex[16], 16);
  const variant = v < 8 ? 'NCS (reserved, backward compatibility)' : v < 12 ? 'RFC 9562 / RFC 4122' : v < 14 ? 'Microsoft (reserved)' : 'Reserved for future definition';
  const info: UuidInfo = { normalized, version, versionName: VERSION_NAMES[version] ?? 'Unknown version', variant };
  if (v >= 8 && v < 12) {
    if (version === 7) info.timestampMs = parseInt(hex.slice(0, 12), 16);
    if (version === 1 || version === 6) {
      const ts =
        version === 1
          ? (BigInt(`0x${hex.slice(13, 16)}`) << 48n) | (BigInt(`0x${hex.slice(8, 12)}`) << 32n) | BigInt(`0x${hex.slice(0, 8)}`)
          : (BigInt(`0x${hex.slice(0, 12)}`) << 12n) | BigInt(`0x${hex.slice(13, 16)}`);
      info.timestampMs = Number((ts - GREGORIAN_OFFSET_100NS) / 10000n);
    }
  }
  return info;
}
