import { describe, expect, it } from 'vitest';
import { contentSignature, viewSignature } from './sceneSignature';

const el = (o: Record<string, unknown> = {}) => ({ id: 'a', type: 'rectangle', x: 0, y: 0, version: 1, versionNonce: 5, updated: 1, ...o });

describe('scene signatures', () => {
  it('ignore version bumps and deleted elements, but see real changes', () => {
    const base = contentSignature([el()], {});
    expect(contentSignature([el({ version: 9, versionNonce: 7, updated: 99 })], {})).toBe(base);
    expect(contentSignature([el(), { id: 'd', type: 'text', isDeleted: true }], {})).toBe(base);
    expect(contentSignature([el({ x: 1 })], {})).not.toBe(base);
    expect(contentSignature([el()], { viewBackgroundColor: '#000' })).not.toBe(base);
    expect(contentSignature([el()], { scrollX: 300, zoom: { value: 2 } })).toBe(base);
  });

  it('view signature tracks viewport and tool prefs only', () => {
    expect(viewSignature({ scrollX: 1 })).not.toBe(viewSignature({ scrollX: 2 }));
    expect(viewSignature({ viewBackgroundColor: '#000' })).toBe(viewSignature({}));
  });
});
