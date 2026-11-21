import { describe, expect, it } from 'vitest';
import { defaultTitle, formatBytes, formatDuration, formatTimecode, safeFilename, spokenDuration } from './format';

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(600_000)).toBe('10:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
  it('treats bad input as zero', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
  });
  it('timecode has tenths', () => {
    expect(formatTimecode(65.25)).toBe('1:05.2');
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(0.3)).toBe('0:00.3');
  });
  it('spoken form', () => {
    expect(spokenDuration(65_000)).toBe('1 minute 5 seconds');
    expect(spokenDuration(1000)).toBe('1 second');
    expect(spokenDuration(0)).toBe('0 seconds');
    expect(spokenDuration(3_600_000)).toBe('1 hour');
  });
});

describe('formatBytes', () => {
  it('uses binary units with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(15.3 * 1024 * 1024)).toBe('15.3 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(2.25 * 1024 ** 3)).toBe('2.25 GB');
  });
});

describe('titles and filenames', () => {
  it('default title in local time', () => {
    expect(defaultTitle(new Date(2026, 9, 3, 9, 5))).toBe('Recording 2026-10-03 09:05');
  });
  it('makes safe filenames', () => {
    expect(safeFilename('Recording 2026-10-03 09:05', 'webm')).toBe('Recording 2026-10-03 09-05.webm');
    expect(safeFilename('a/b\\c*?"<>|', '.mp4')).toBe('abc.mp4');
    expect(safeFilename('   ', 'mp4')).toBe('Recording.mp4');
    expect(safeFilename('...hidden', 'mp4')).toBe('hidden.mp4');
    expect(safeFilename('x'.repeat(300), 'mp4')).toHaveLength(124);
  });
});
