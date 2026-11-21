import { describe, expect, it } from 'vitest';
import { detectUnit, isoWeek, parseTimestamp, timestampRows } from './timestamp';
import { datetimeLocalValue, formatDuration, isoInZone, parseDatetimeLocal, relativeTime, tzOffsetMinutes, zonedParts, zonedTimeToUtc } from './time';

const T = Date.UTC(2024, 2, 10, 8, 30, 15, 250); // 2024-03-10T08:30:15.250Z

describe('parseTimestamp', () => {
  it('auto-detects seconds, ms, µs and ns', () => {
    expect(parseTimestamp('1710059415')).toEqual({ ok: true, ms: 1710059415000, unit: 's' });
    expect(parseTimestamp('1710059415250')).toEqual({ ok: true, ms: T, unit: 'ms' });
    expect(parseTimestamp('1710059415250123')).toMatchObject({ ok: true, ms: T, unit: 'us' });
    expect(parseTimestamp('1710059415250123456')).toMatchObject({ ok: true, ms: T, unit: 'ns' });
    expect(detectUnit(10)).toBe('s');
    expect(detectUnit(13)).toBe('ms');
  });
  it('honours an explicit unit, separators, negatives and decimals', () => {
    expect(parseTimestamp('1710059415', 'ms')).toMatchObject({ ms: 1710059415 });
    expect(parseTimestamp('1_710_059_415')).toMatchObject({ ms: 1710059415000 });
    expect(parseTimestamp('-86400')).toMatchObject({ ms: -86400000 });
    expect(parseTimestamp('1710059415.25')).toMatchObject({ ms: T });
  });
  it('parses date strings and "now"', () => {
    expect(parseTimestamp('2024-03-10T08:30:15.250Z')).toEqual({ ok: true, ms: T, unit: 'date' });
    expect(parseTimestamp('now', 'auto', 42)).toMatchObject({ ms: 42 });
    expect(parseTimestamp('garbage').ok).toBe(false);
    expect(parseTimestamp('').ok).toBe(false);
    expect(parseTimestamp('99999999999999999999999').ok).toBe(false);
  });
});

describe('time zones', () => {
  it('zonedParts in UTC and fixed-offset zones', () => {
    expect(zonedParts(T, 'UTC')).toEqual({ year: 2024, month: 3, day: 10, hour: 8, minute: 30, second: 15, weekday: 0 });
    expect(zonedParts(T, 'Asia/Kolkata')).toMatchObject({ hour: 14, minute: 0, weekday: 0 });
    expect(zonedParts(T, 'Asia/Tokyo')).toMatchObject({ hour: 17, minute: 30 });
  });
  it('offsets, including DST', () => {
    expect(tzOffsetMinutes(T, 'Asia/Kolkata')).toBe(330);
    expect(tzOffsetMinutes(T, 'UTC')).toBe(0);
    expect(tzOffsetMinutes(Date.UTC(2024, 0, 15), 'America/New_York')).toBe(-300);
    expect(tzOffsetMinutes(Date.UTC(2024, 6, 15), 'America/New_York')).toBe(-240);
  });
  it('zonedTimeToUtc inverts wall-clock time', () => {
    expect(zonedTimeToUtc(2024, 3, 10, 14, 0, 15, 250, 'Asia/Kolkata')).toBe(T);
    expect(zonedTimeToUtc(2024, 3, 10, 8, 30, 15, 250, 'UTC')).toBe(T);
    expect(zonedTimeToUtc(2024, 7, 1, 12, 0, 0, 0, 'America/New_York')).toBe(Date.UTC(2024, 6, 1, 16));
    // Overflowing fields normalise: month 13 → January next year.
    expect(zonedTimeToUtc(2023, 13, 1, 0, 0, 0, 0, 'UTC')).toBe(Date.UTC(2024, 0, 1));
  });
  it('ISO with offsets and datetime-local round trip', () => {
    expect(isoInZone(T, 'UTC')).toBe('2024-03-10T08:30:15.250Z');
    expect(isoInZone(T, 'Asia/Kolkata')).toBe('2024-03-10T14:00:15.250+05:30');
    expect(datetimeLocalValue(T, 'Asia/Kolkata')).toBe('2024-03-10T14:00:15');
    expect(parseDatetimeLocal('2024-03-10T14:00:15', 'Asia/Kolkata')).toBe(T - 250);
    expect(parseDatetimeLocal('2024-03-10T08:30', 'UTC')).toBe(Date.UTC(2024, 2, 10, 8, 30));
    expect(parseDatetimeLocal('nope', 'UTC')).toBeNull();
  });
  it('relative time and durations', () => {
    expect(relativeTime(T - 3 * 3600e3, T)).toBe('3 hours ago');
    expect(relativeTime(T + 2 * 86400e3, T)).toBe('in 2 days');
    expect(relativeTime(T, T)).toBe('now');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
    expect(formatDuration(90 * 1000)).toBe('1m 30s');
  });
  it('ISO week numbers', () => {
    expect(isoWeek(2021, 1, 3)).toEqual({ week: 53, year: 2020 });
    expect(isoWeek(2024, 12, 30)).toEqual({ week: 1, year: 2025 });
    expect(isoWeek(2024, 3, 10)).toEqual({ week: 10, year: 2024 });
  });
  it('timestampRows lists the main representations', () => {
    const rows = timestampRows(T, 'UTC', T + 60_000);
    expect(rows.find((r) => r.label === 'Unix seconds')?.value).toBe('1710059415');
    expect(rows.find((r) => r.label === 'ISO 8601 (UTC)')?.value).toBe('2024-03-10T08:30:15.250Z');
    expect(rows.find((r) => r.label === 'Relative')?.value).toBe('1 minute ago');
  });
});
