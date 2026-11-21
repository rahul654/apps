import { describe, expect, it } from 'vitest';
import { createUuidV7Generator, formatUuid, inspectUuid, uuidv4, uuidv7 } from './uuid';

const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuid v4', () => {
  it('has the right format, version and variant', () => {
    for (let i = 0; i < 100; i++) {
      const u = uuidv4();
      expect(u).toMatch(RE);
      expect(u[14]).toBe('4');
      expect('89ab').toContain(u[19]);
    }
  });
});

describe('uuid v7 (RFC 9562)', () => {
  it('encodes the Unix ms timestamp in the first 48 bits', () => {
    const ms = 0x017f22e279b0; // RFC 9562 appendix A.6 example: 2022-02-22T19:22:22Z
    const u = createUuidV7Generator(() => ms)();
    expect(u.slice(0, 13)).toBe('017f22e2-79b0');
    expect(u[14]).toBe('7');
    expect('89ab').toContain(u[19]);
    expect(inspectUuid(u)).toMatchObject({ version: 7, timestampMs: ms, variant: 'RFC 9562 / RFC 4122' });
  });
  it('is monotonic within the same millisecond and across counter overflow', () => {
    const gen = createUuidV7Generator(() => 1_700_000_000_000);
    const ids = Array.from({ length: 10_000 }, gen);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(RE);
  });
  it('stays ordered when the clock goes backwards', () => {
    let t = 2_000_000;
    const gen = createUuidV7Generator(() => t);
    const a = gen();
    t -= 1000;
    const b = gen();
    expect(b > a).toBe(true);
  });
  it('default generator produces valid, increasing IDs', () => {
    const ids = Array.from({ length: 200 }, uuidv7);
    expect([...ids].sort()).toEqual(ids);
    expect(Math.abs(inspectUuid(ids[0])!.timestampMs! - Date.now())).toBeLessThan(5000);
  });
});

describe('format & inspect', () => {
  it('formats uppercase / without hyphens', () => {
    expect(formatUuid('0f8fad5b-d9cb-469f-a165-70867728950e', { uppercase: true, hyphens: false })).toBe('0F8FAD5BD9CB469FA16570867728950E');
  });
  it('accepts braces, urn and no hyphens', () => {
    expect(inspectUuid('{0F8FAD5B-D9CB-469F-A165-70867728950E}')?.normalized).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(inspectUuid('urn:uuid:0f8fad5bd9cb469fa16570867728950e')?.version).toBe(4);
    expect(inspectUuid('not-a-uuid')).toBeNull();
    expect(inspectUuid('0f8fad5b-d9cb-469f-a165-70867728950')).toBeNull();
  });
  it('recognises nil/max and v1 timestamps', () => {
    expect(inspectUuid('00000000-0000-0000-0000-000000000000')?.special).toBe('nil');
    expect(inspectUuid('ffffffff-ffff-ffff-ffff-ffffffffffff')?.special).toBe('max');
    // RFC 9562 A.1 v1 example: 2022-02-22T19:22:22.000Z
    const v1 = inspectUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846')!;
    expect(v1.version).toBe(1);
    expect(new Date(v1.timestampMs!).toISOString()).toBe('2022-02-22T19:22:22.000Z');
    // RFC 9562 A.5 v6 example, same instant.
    const v6 = inspectUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846')!;
    expect(new Date(v6.timestampMs!).toISOString()).toBe('2022-02-22T19:22:22.000Z');
    expect(inspectUuid('0f8fad5b-d9cb-469f-c165-70867728950e')?.variant).toMatch(/Microsoft/);
  });
});
