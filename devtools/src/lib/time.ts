// Time-zone and duration helpers built on Intl (no dependencies).

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      era: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export const isUtc = (tz: string) => tz === 'UTC' || tz === 'Etc/UTC' || tz === 'GMT' || tz === 'Etc/GMT';

/** Wall-clock fields of an instant in an IANA time zone. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  if (isUtc(tz)) {
    const d = new Date(ms);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      weekday: d.getUTCDay(),
    };
  }
  const out: Partial<ZonedParts> & { bc?: boolean } = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    switch (p.type) {
      case 'year':
        out.year = Number(p.value);
        break;
      case 'month':
        out.month = Number(p.value);
        break;
      case 'day':
        out.day = Number(p.value);
        break;
      case 'hour':
        out.hour = Number(p.value) % 24;
        break;
      case 'minute':
        out.minute = Number(p.value);
        break;
      case 'second':
        out.second = Number(p.value);
        break;
      case 'weekday':
        out.weekday = WEEKDAYS[p.value] ?? 0;
        break;
      case 'era':
        out.bc = p.value.startsWith('B');
        break;
    }
  }
  if (out.bc && out.year !== undefined) out.year = 1 - out.year;
  return out as ZonedParts;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Offset of `tz` from UTC at the given instant, in minutes (e.g. +330 for Asia/Kolkata). */
export function tzOffsetMinutes(ms: number, tz: string): number {
  if (isUtc(tz)) return 0;
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const fixed = new Date(asUtc);
  if (p.year >= 0 && p.year < 100) fixed.setUTCFullYear(p.year);
  return Math.round((fixed.getTime() - (ms - mod(ms, 1000))) / 60000);
}

/**
 * Instant for a wall-clock time in `tz`. Fields may overflow (month 13, day 32…) and are
 * normalised like Date.UTC. Non-existent local times (DST gap) resolve forward by the gap.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millis = 0, tz = 'UTC'): number {
  const d = new Date(Date.UTC(2000, 0, 1, hour, minute, second, millis));
  d.setUTCFullYear(year, month - 1, day);
  const guess = d.getTime();
  if (isUtc(tz)) return guess;
  const off1 = tzOffsetMinutes(guess, tz);
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return t;
}

export function formatOffset(minutes: number, colon = true): string {
  const sign = minutes < 0 ? '-' : '+';
  const a = Math.abs(minutes);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${sign}${hh}${colon ? ':' : ''}${mm}`;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function padYear(y: number): string {
  if (y >= 0 && y <= 9999) return pad(y, 4);
  return (y < 0 ? '-' : '+') + pad(Math.abs(y), 6);
}

/** ISO 8601 with the zone's offset, e.g. 2024-03-10T08:30:00.000+05:30 (or Z for UTC). */
export function isoInZone(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  const off = tzOffsetMinutes(ms, tz);
  const millis = pad(mod(ms, 1000), 3);
  const date = `${padYear(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${millis}`;
  return date + (isUtc(tz) ? 'Z' : formatOffset(off));
}

/** "YYYY-MM-DDTHH:mm:ss" wall-clock value for <input type="datetime-local">. */
export function datetimeLocalValue(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${padYear(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Parse the value of <input type="datetime-local"> as wall-clock time in `tz`. */
export function parseDatetimeLocal(value: string, tz: string): number | null {
  const m = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return zonedTimeToUtc(+y, +mo, +d, +h, +mi, s ? +s : 0, ms ? +ms.padEnd(3, '0') : 0, tz);
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const FALLBACK_ZONES = ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

export function allTimeZones(): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    list = [];
  }
  if (list.length === 0) list = FALLBACK_ZONES;
  const set = new Set(['UTC', localTimeZone(), ...list]);
  return [...set];
}

/** Human date in a zone, e.g. "Tue, 12 Mar 2024, 14:05:09 GMT+5:30". */
export function humanInZone(ms: number, tz: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(ms));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365.25 * 24 * 3600e3],
  ['month', 30.44 * 24 * 3600e3],
  ['week', 7 * 24 * 3600e3],
  ['day', 24 * 3600e3],
  ['hour', 3600e3],
  ['minute', 60e3],
  ['second', 1e3],
];

/** "3 hours ago" / "in 2 days". */
export function relativeTime(ms: number, now: number, locale = 'en'): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 1000) return rtf.format(0, 'second');
  for (const [unit, size] of UNITS) {
    if (abs >= size || unit === 'second') return rtf.format(Math.trunc(diff / size), unit);
  }
  return '';
}

/** Compact duration, e.g. "2d 3h", "45m 10s", "0s". Uses the two largest units. */
export function formatDuration(ms: number): string {
  let s = Math.floor(Math.abs(ms) / 1000);
  const parts: string[] = [];
  const units: [string, number][] = [
    ['y', 365 * 86400],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  for (const [label, size] of units) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)}${label}`);
      s %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.length ? parts.join(' ') : '0s';
}
