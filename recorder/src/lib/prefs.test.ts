import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from './prefs';

describe('parsePrefs', () => {
  it('returns defaults for missing / corrupt data', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[1,2]')).toEqual(DEFAULT_PREFS);
  });
  it('keeps valid fields and replaces invalid ones', () => {
    const p = parsePrefs(JSON.stringify({ mode: 'audio', fps: 60, micGain: 9, bubbleX: -1, resolution: '4k', cameraId: 'abc', countdown: 'yes' }));
    expect(p.mode).toBe('audio');
    expect(p.fps).toBe(60);
    expect(p.micGain).toBe(2);
    expect(p.bubbleX).toBe(0);
    expect(p.resolution).toBe(DEFAULT_PREFS.resolution);
    expect(p.cameraId).toBe('abc');
    expect(p.countdown).toBe(true);
  });
});
