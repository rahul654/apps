import { describe, expect, it } from 'vitest';
import { formatBytes, formatClock, formatDuration, formatTimestamp, spokenTime, srtTime, toMillis, vttTime } from './time';

describe('timestamps', () => {
  it('formats SRT with a comma and VTT with a dot', () => {
    expect(srtTime(62.345)).toBe('00:01:02,345');
    expect(vttTime(62.345)).toBe('00:01:02.345');
  });

  it('handles zero, hours and long durations', () => {
    expect(srtTime(0)).toBe('00:00:00,000');
    expect(vttTime(3600)).toBe('01:00:00.000');
    expect(vttTime(3723.004)).toBe('01:02:03.004');
    expect(srtTime(359999.999)).toBe('99:59:59,999');
    expect(srtTime(360000)).toBe('100:00:00,000');
  });

  it('rounds to the nearest millisecond before carrying', () => {
    expect(vttTime(59.9996)).toBe('00:01:00.000');
    expect(vttTime(59.9994)).toBe('00:00:59.999');
    expect(vttTime(3599.9999)).toBe('01:00:00.000');
    expect(srtTime(1.0005)).toBe('00:00:01,001');
    // Float noise: 0.1 + 0.2
    expect(vttTime(0.1 + 0.2)).toBe('00:00:00.300');
  });

  it('clamps negative and non-finite values to zero', () => {
    expect(vttTime(-1)).toBe('00:00:00.000');
    expect(vttTime(Number.NaN)).toBe('00:00:00.000');
    expect(vttTime(Infinity)).toBe('00:00:00.000');
    expect(toMillis(-0.5)).toBe(0);
  });

  it('defaults to the VTT separator', () => {
    expect(formatTimestamp(1.5)).toBe('00:00:01.500');
  });
});

describe('human formats', () => {
  it('clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5.9)).toBe('0:05');
    expect(formatClock(754)).toBe('12:34');
    expect(formatClock(3723)).toBe('1:02:03');
  });
  it('duration', () => {
    expect(formatDuration(45.4)).toBe('45 s');
    expect(formatDuration(185)).toBe('3 min 05 s');
    expect(formatDuration(3720)).toBe('1 h 02 min');
  });
  it('spoken', () => {
    expect(spokenTime(0)).toBe('0 seconds');
    expect(spokenTime(65)).toBe('1 minute 5 seconds');
    expect(spokenTime(3601)).toBe('1 hour 1 second');
  });
  it('bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(43_600_000)).toBe('43.6 MB');
    expect(formatBytes(251_900_000)).toBe('252 MB');
  });
});

describe('plural', () => {
  it('picks the form', async () => {
    const { plural } = await import('./time');
    expect(plural(1, 'segment')).toBe('1 segment');
    expect(plural(0, 'segment')).toBe('0 segments');
    expect(plural(2, 'query', 'queries')).toBe('2 queries');
  });
});
