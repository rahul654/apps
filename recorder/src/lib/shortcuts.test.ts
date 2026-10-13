import { describe, expect, it } from 'vitest';
import { matchShortcut, shortcutLabel, type KeyLike } from './shortcuts';

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ code, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...mods });
const altShift = { altKey: true, shiftKey: true };

describe('matchShortcut', () => {
  it('maps Alt+Shift+R / P by physical key', () => {
    expect(matchShortcut(key('KeyR', altShift), { countdown: false })).toBe('toggle-record');
    expect(matchShortcut(key('KeyP', { ...altShift, key: 'Π' }), { countdown: false })).toBe('toggle-pause');
  });
  it('ignores other modifier combos and repeats', () => {
    expect(matchShortcut(key('KeyR', { altKey: true }), { countdown: false })).toBeNull();
    expect(matchShortcut(key('KeyR', { ...altShift, ctrlKey: true }), { countdown: false })).toBeNull();
    expect(matchShortcut(key('KeyR', { ...altShift, repeat: true }), { countdown: false })).toBeNull();
    expect(matchShortcut(key('KeyR'), { countdown: false })).toBeNull();
  });
  it('Space / Enter skips and Escape cancels only during the countdown', () => {
    expect(matchShortcut(key('Space'), { countdown: true })).toBe('skip-countdown');
    expect(matchShortcut(key('Enter'), { countdown: true })).toBe('skip-countdown');
    expect(matchShortcut(key('Escape'), { countdown: true })).toBe('cancel-countdown');
    expect(matchShortcut(key('Space'), { countdown: false })).toBeNull();
  });
  it('does not steal Space while typing, but Alt+Shift combos still work', () => {
    expect(matchShortcut(key('Space', { targetTag: 'input' }), { countdown: true })).toBeNull();
    expect(matchShortcut(key('Space', { targetEditable: true }), { countdown: true })).toBeNull();
    expect(matchShortcut(key('KeyR', { ...altShift, targetTag: 'INPUT' }), { countdown: false })).toBe('toggle-record');
  });
});

describe('shortcutLabel', () => {
  it('uses macOS symbols on Mac', () => {
    expect(shortcutLabel('Alt+Shift+R', true)).toBe('⌥⇧R');
    expect(shortcutLabel('Alt+Shift+R', false)).toBe('Alt+Shift+R');
  });
});
