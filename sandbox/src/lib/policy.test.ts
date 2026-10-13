import { describe, expect, it } from 'vitest';
import { allowAttr, effectiveTokens, orderFeatures, orderTokens, PRESETS, presetOf } from './policy';

const APP = 'https://rahul654.github.io';

describe('presets', () => {
  it('recognises presets regardless of order or duplicates', () => {
    expect(presetOf([])).toBe('strict');
    expect(presetOf([...PRESETS.isolated.tokens].reverse())).toBe('isolated');
    expect(presetOf([...PRESETS.standard.tokens, 'allow-scripts'])).toBe('standard');
    expect(presetOf(['allow-scripts'])).toBe('custom');
  });

  it('strict has no tokens; isolated never keeps the origin', () => {
    expect(PRESETS.strict.tokens).toEqual([]);
    expect(PRESETS.isolated.tokens).not.toContain('allow-same-origin');
    expect(PRESETS.standard.tokens).toContain('allow-same-origin');
  });

  it('no preset escapes the sandbox or navigates the app', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.tokens).not.toContain('allow-popups-to-escape-sandbox');
      expect(p.tokens).not.toContain('allow-top-navigation-by-user-activation');
    }
  });
});

describe('orderTokens', () => {
  it('drops unknown tokens (including allow-top-navigation) and sorts', () => {
    expect(orderTokens(['allow-forms', 'allow-top-navigation', 'bogus', 'allow-scripts', 'allow-forms'])).toEqual(['allow-scripts', 'allow-forms']);
  });
});

describe('effectiveTokens', () => {
  const standard = PRESETS.standard.tokens;

  it('keeps the site’s origin for other sites', () => {
    const r = effectiveTokens({ kind: 'web', tokens: standard, url: 'https://en.wikipedia.org/' }, APP);
    expect(r.tokens).toContain('allow-same-origin');
    expect(r.dropped).toEqual([]);
  });

  it('never gives HTML sandboxes same-origin (srcdoc would inherit this app’s origin)', () => {
    const r = effectiveTokens({ kind: 'html', tokens: standard, url: '' }, APP);
    expect(r.tokens).not.toContain('allow-same-origin');
    expect(r.tokens).toContain('allow-scripts');
    expect(r.dropped.map((d) => d.token)).toEqual(['allow-same-origin']);
  });

  it('drops same-origin for pages on this app’s own origin when scripts run', () => {
    const r = effectiveTokens({ kind: 'web', tokens: standard, url: `${APP}/apps/splitwise/` }, APP);
    expect(r.tokens).not.toContain('allow-same-origin');
    expect(r.dropped).toHaveLength(1);
  });

  it('allows same-origin on this origin when scripts are off (nothing can run to escape)', () => {
    const r = effectiveTokens({ kind: 'web', tokens: ['allow-same-origin'], url: `${APP}/apps/` }, APP);
    expect(r.tokens).toEqual(['allow-same-origin']);
  });
});

describe('allowAttr', () => {
  it('delegates listed features with * and nothing else', () => {
    expect(allowAttr([])).toBe('');
    expect(allowAttr(['camera', 'fullscreen', 'camera'])).toBe('fullscreen *; camera *');
  });

  it('orderFeatures drops unknown names', () => {
    expect(orderFeatures(['usb', 'geolocation', 'fullscreen'])).toEqual(['fullscreen', 'geolocation']);
  });
});
