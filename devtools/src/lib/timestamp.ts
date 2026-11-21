// Unix timestamp parsing and conversions.
import { humanInZone, isoInZone, relativeTime, zonedParts } from './time';

export type TsUnit = 'auto' | 's' | 'ms' | 'us' | 'ns';

export const UNIT_LABEL: Record<Exclude<TsUnit, 'auto'>, string> = {
  s: 'seconds',
  ms: 'milliseconds',
  us: 'microseconds',
  ns: 'nanoseconds',
};

const TO_MS: Record<Exclude<TsUnit, 'auto'>, number> = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 };

/** Guess the unit of a numeric timestamp from the number of integer digits. */
export function detectUnit(intDigits: number): Exclude<TsUnit, 'auto'> {
  if (intDigits <= 11) return 's';
  if (intDigits <= 14) return 'ms';
  if (intDigits <= 17) return 'us';
  return 'ns';
}

export type TsParse = { ok: true; ms: number; unit: Exclude<TsUnit, 'auto'> | 'date' } | { ok: false; error: string };

const MAX_MS = 8.64e15;

/** Parse a timestamp (number in any unit) or a date string into epoch milliseconds. */
export function parseTimestamp(input: string, unit: TsUnit = 'auto', now = Date.now()): TsParse {
  const s = input.trim().replace(/[_,\s](?=\d)/g, '');
  if (s === '') return { ok: false, error: 'Enter a timestamp or date' };
  if (s.toLowerCase() === 'now') return { ok: true, ms: now, unit: 'ms' };
  const num = /^([+-]?)(\d+)(\.\d+)?$/.exec(s);
  if (num) {
    const u = unit === 'auto' ? detectUnit(num[2].replace(/^0+(?=\d)/, '').length) : unit;
    const ms = Number(s) * TO_MS[u];
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) return { ok: false, error: 'Timestamp is outside the supported date range (±275,760 years)' };
    return { ok: true, ms: u === 's' || u === 'ms' ? Math.round(ms * 1000) / 1000 : Math.floor(ms), unit: u };
  }
  const t = Date.parse(input.trim());
  if (Number.isNaN(t)) return { ok: false, error: 'Not a number or a date string the browser can parse (try ISO 8601, e.g. 2024-03-10T08:30:00Z)' };
  return { ok: true, ms: t, unit: 'date' };
}

/** ISO 8601 week number and ISO week-year for a calendar date. */
export function isoWeek(year: number, month: number, day: number): { week: number; year: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { week: Math.ceil(((d.getTime() - yStart) / 86400000 + 1) / 7), year: d.getUTCFullYear() };
}

export function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

export interface TsRow {
  label: string;
  value: string;
}

/** All the representations shown in the converter. */
export function timestampRows(ms: number, tz: string, now: number): TsRow[] {
  const p = zonedParts(ms, tz);
  const wk = isoWeek(p.year, p.month, p.day);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(new Date(ms));
  return [
    { label: 'Unix seconds', value: String(Math.floor(ms / 1000)) },
    { label: 'Unix milliseconds', value: String(Math.floor(ms)) },
    { label: 'ISO 8601 (UTC)', value: new Date(ms).toISOString() },
    { label: `ISO 8601 (${tz})`, value: isoInZone(Math.floor(ms), tz) },
    { label: 'RFC 7231 / UTC string', value: new Date(ms).toUTCString() },
    { label: `Human (${tz})`, value: humanInZone(ms, tz) },
    { label: 'Relative', value: relativeTime(ms, now) },
    { label: 'Day / week', value: `${weekday}, day ${dayOfYear(p.year, p.month, p.day)} of year, ISO week ${wk.week} of ${wk.year}` },
  ];
}
