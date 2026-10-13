import { describe, expect, it } from 'vitest';
import { CronError, describeCron, nextRuns, ordinal, parseCron } from './cron';

const iso = (ms: number[]) => ms.map((t) => new Date(t).toISOString().slice(0, 16));
const FROM = Date.UTC(2024, 0, 1, 0, 0, 30); // Mon 2024-01-01 00:00:30Z

describe('parseCron', () => {
  it('expands *, lists, ranges and steps', () => {
    const c = parseCron('*/15 9-17/4 1,15 * 1-5');
    expect(c.minute.values).toEqual([0, 15, 30, 45]);
    expect(c.hour.values).toEqual([9, 13, 17]);
    expect(c.dayOfMonth.values).toEqual([1, 15]);
    expect(c.month.full).toBe(true);
    expect(c.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);
  });
  it('supports names (case-insensitive), 7 = Sunday and value/step', () => {
    const c = parseCron('0 0 * jan-mar,DEC sun,7');
    expect(c.month.values).toEqual([1, 2, 3, 12]);
    expect(c.dayOfWeek.values).toEqual([0]);
    expect(parseCron('5/20 * * * *').minute.values).toEqual([5, 25, 45]);
    expect(parseCron('0 0 * * 5-7').dayOfWeek.values).toEqual([0, 5, 6]);
  });
  it('expands macros', () => {
    expect(parseCron('@daily').expanded).toBe('0 0 * * *');
    expect(parseCron('@hourly').expanded).toBe('0 * * * *');
    expect(parseCron('@weekly').expanded).toBe('0 0 * * 0');
    expect(parseCron('@yearly').macro).toBe('@yearly');
  });
  it('rejects invalid expressions with field-specific errors', () => {
    const bad: [string, RegExp][] = [
      ['60 * * * *', /Minute: 60 is out of range/],
      ['* 24 * * *', /Hour: 24/],
      ['* * 0 * *', /Day of month: 0/],
      ['* * * 13 *', /Month: 13/],
      ['* * * * 8', /Day of week: 8/],
      ['* * * * MON-', /not a valid range/],
      ['*/0 * * * *', /step "0"/],
      ['5-1 * * * *', /starts after it ends/],
      ['* * * *', /Expected 5 fields/],
      ['0 * * * * *', /6 fields/],
      ['* * L * *', /Quartz/],
      ['@reboot', /startup/],
      ['@often', /Unknown macro/],
      ['1,,2 * * * *', /empty list item/],
    ];
    for (const [expr, re] of bad) expect(() => parseCron(expr), expr).toThrow(re);
    expect(() => parseCron('* * * * 9')).toThrow(CronError);
  });
});

describe('nextRuns (UTC)', () => {
  it('every 15 minutes', () => {
    expect(iso(nextRuns(parseCron('*/15 * * * *'), FROM, 5))).toEqual(['2024-01-01T00:15', '2024-01-01T00:30', '2024-01-01T00:45', '2024-01-01T01:00', '2024-01-01T01:15']);
  });
  it('starts strictly after `from`', () => {
    expect(iso(nextRuns(parseCron('0 0 * * *'), Date.UTC(2024, 0, 1, 0, 0), 2))).toEqual(['2024-01-02T00:00', '2024-01-03T00:00']);
  });
  it('weekdays at 09:30 skip the weekend', () => {
    expect(iso(nextRuns(parseCron('30 9 * * mon-fri'), Date.UTC(2024, 0, 5, 12), 3))).toEqual(['2024-01-08T09:30', '2024-01-09T09:30', '2024-01-10T09:30']);
  });
  it('lists and ranges in hours', () => {
    expect(iso(nextRuns(parseCron('0 9,17 * * *'), FROM, 3))).toEqual(['2024-01-01T09:00', '2024-01-01T17:00', '2024-01-02T09:00']);
    expect(iso(nextRuns(parseCron('0 22-23/1 * * *'), FROM, 3))).toEqual(['2024-01-01T22:00', '2024-01-01T23:00', '2024-01-02T22:00']);
  });
  it('day-of-month OR day-of-week when both are restricted', () => {
    // 1st and 15th of the month OR any Friday (Jan 2024: Fridays are 5, 12, 19, 26).
    expect(iso(nextRuns(parseCron('0 12 1,15 * fri'), FROM, 6))).toEqual([
      '2024-01-01T12:00',
      '2024-01-05T12:00',
      '2024-01-12T12:00',
      '2024-01-15T12:00',
      '2024-01-19T12:00',
      '2024-01-26T12:00',
    ]);
  });
  it('AND semantics when one day field starts with *', () => {
    // "*/2" day-of-month is still a "star" field in Vixie cron → odd days that are also Mondays.
    expect(iso(nextRuns(parseCron('0 0 */2 * 1'), FROM, 3))).toEqual(['2024-01-15T00:00', '2024-01-29T00:00', '2024-02-05T00:00']);
    // Only day-of-week restricted.
    expect(iso(nextRuns(parseCron('0 0 * * 0'), FROM, 2))).toEqual(['2024-01-07T00:00', '2024-01-14T00:00']);
  });
  it('month steps and month boundaries', () => {
    expect(iso(nextRuns(parseCron('0 0 1 */3 *'), FROM, 4))).toEqual(['2024-04-01T00:00', '2024-07-01T00:00', '2024-10-01T00:00', '2025-01-01T00:00']);
    expect(iso(nextRuns(parseCron('0 0 31 * *'), FROM, 3))).toEqual(['2024-01-31T00:00', '2024-03-31T00:00', '2024-05-31T00:00']);
  });
  it('leap day and impossible dates', () => {
    expect(iso(nextRuns(parseCron('0 0 29 2 *'), Date.UTC(2024, 2, 1), 2))).toEqual(['2028-02-29T00:00', '2032-02-29T00:00']);
    expect(nextRuns(parseCron('0 0 30 2 *'), FROM, 3)).toEqual([]);
  });
  it('macros', () => {
    expect(iso(nextRuns(parseCron('@monthly'), FROM, 2))).toEqual(['2024-02-01T00:00', '2024-03-01T00:00']);
    expect(iso(nextRuns(parseCron('@yearly'), FROM, 1))).toEqual(['2025-01-01T00:00']);
  });
  it('returns the requested count', () => {
    expect(nextRuns(parseCron('* * * * *'), FROM, 10)).toHaveLength(10);
  });
});

describe('nextRuns (time zones)', () => {
  it('evaluates on the wall clock of the zone (no DST: Asia/Kolkata)', () => {
    // 09:00 IST = 03:30 UTC
    expect(iso(nextRuns(parseCron('0 9 * * *'), FROM, 2, 'Asia/Kolkata'))).toEqual(['2024-01-01T03:30', '2024-01-02T03:30']);
  });
  it('skips local times that do not exist on DST start', () => {
    // America/New_York jumps 02:00 → 03:00 on 2024-03-10.
    const runs = iso(nextRuns(parseCron('30 2 * * *'), Date.UTC(2024, 2, 9, 12), 2, 'America/New_York'));
    expect(runs).toEqual(['2024-03-11T06:30', '2024-03-12T06:30']);
  });
  it('runs once in the repeated hour on DST end', () => {
    // 2024-11-03 01:00-01:59 happens twice in New York.
    const runs = iso(nextRuns(parseCron('30 1 * * *'), Date.UTC(2024, 10, 2, 12), 2, 'America/New_York'));
    expect(runs).toEqual(['2024-11-03T05:30', '2024-11-04T06:30']);
  });
});

describe('describeCron', () => {
  const d = (e: string) => describeCron(parseCron(e));
  it('describes common expressions', () => {
    expect(d('* * * * *')).toBe('Every minute');
    expect(d('*/5 * * * *')).toBe('Every 5 minutes');
    expect(d('0 * * * *')).toBe('At minute 0 of every hour');
    expect(d('30 9 * * 1-5')).toBe('At 09:30, on Monday through Friday');
    expect(d('0 9,17 * * *')).toBe('At 09:00 and 17:00');
    expect(d('@daily')).toBe('At 00:00');
    expect(d('0 0 1 * *')).toBe('At 00:00, on day-of-month 1');
    expect(d('23 0-20/2 * * *')).toBe('At minute 23 past every 2nd hour from 0 through 20');
    expect(d('0 0 1,15 * fri')).toBe('At 00:00, on days-of-month 1 and 15 or on Friday');
    expect(d('0 0 1 */3 *')).toBe('At 00:00, on day-of-month 1, in every 3rd month');
    expect(d('0 12 * jan,jul *')).toBe('At 12:00, in January and July');
    expect(d('*/10 9-17 * * *')).toBe('Every 10 minutes past every hour from 9 through 17');
    expect(d('0 0 */2 * 1')).toBe('At 00:00, on every 2nd day-of-month, if it is also Monday');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });
});
