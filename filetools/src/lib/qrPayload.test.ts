import { describe, expect, it } from 'vitest';
import {
  buildEmailPayload,
  buildPhonePayload,
  buildSmsPayload,
  buildVCard,
  buildWifiPayload,
  classifyDecoded,
  escapeVCard,
  escapeWifi,
  parseWifiPayload,
} from './qrPayload';

describe('Wi-Fi payload', () => {
  it('builds a WPA payload', () => {
    expect(buildWifiPayload({ ssid: 'Home', password: 'secret123', encryption: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:Home;P:secret123;;');
  });
  it('builds open and hidden networks', () => {
    expect(buildWifiPayload({ ssid: 'Cafe', password: 'ignored', encryption: 'nopass', hidden: false })).toBe('WIFI:T:nopass;S:Cafe;;');
    expect(buildWifiPayload({ ssid: 'X', password: 'p', encryption: 'WEP', hidden: true })).toBe('WIFI:T:WEP;S:X;P:p;H:true;;');
  });
  it('escapes ; , : " and backslash', () => {
    expect(escapeWifi('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f');
    const payload = buildWifiPayload({ ssid: 'My;Net,"1"', password: 'p:a\\ss;', encryption: 'WPA', hidden: false });
    expect(payload).toBe('WIFI:T:WPA;S:My\\;Net\\,\\"1\\";P:p\\:a\\\\ss\\;;;');
  });
  it('round-trips through the parser', () => {
    const cfgs = [
      { ssid: 'My;Net,"1"', password: 'p:a\\ss;', encryption: 'WPA' as const, hidden: false },
      { ssid: 'Open: guest', password: '', encryption: 'nopass' as const, hidden: true },
      { ssid: 'w', password: ';;;', encryption: 'WEP' as const, hidden: false },
    ];
    for (const c of cfgs) expect(parseWifiPayload(buildWifiPayload(c))).toEqual(c);
  });
  it('parses real-world variants (field order, case, missing T)', () => {
    expect(parseWifiPayload('wifi:S:Office;T:WPA2;P:abc;;')).toEqual({ ssid: 'Office', password: 'abc', encryption: 'WPA', hidden: false });
    expect(parseWifiPayload('WIFI:S:Lobby;;')).toEqual({ ssid: 'Lobby', password: '', encryption: 'nopass', hidden: false });
    expect(parseWifiPayload('WIFI:P:x;S:Y;')).toEqual({ ssid: 'Y', password: 'x', encryption: 'WPA', hidden: false });
  });
  it('returns null for non-Wi-Fi text', () => {
    expect(parseWifiPayload('hello')).toBeNull();
    expect(parseWifiPayload('WIFI:T:WPA;P:x;;')).toBeNull();
  });
  it('requires an SSID', () => {
    expect(() => buildWifiPayload({ ssid: '', password: '', encryption: 'WPA', hidden: false })).toThrow();
  });
});

describe('vCard', () => {
  it('escapes text values', () => {
    expect(escapeVCard('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
  it('builds a vCard 3.0 with CRLF line endings', () => {
    const v = buildVCard({ firstName: 'Priya', lastName: 'Shah', organization: 'Acme, Inc.', mobile: '+91 98765 43210', email: 'p@example.com', city: 'Mumbai', note: 'Line1\nLine2' });
    expect(v.split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Shah;Priya;;;',
      'FN:Priya Shah',
      'ORG:Acme\\, Inc.',
      'TEL;TYPE=CELL:+91 98765 43210',
      'EMAIL:p@example.com',
      'ADR;TYPE=WORK:;;;Mumbai;;;',
      'NOTE:Line1\\nLine2',
      'END:VCARD',
    ]);
  });
  it('requires a name or organisation', () => {
    expect(() => buildVCard({ firstName: ' ', lastName: '' })).toThrow();
    expect(buildVCard({ firstName: '', lastName: '', organization: 'Org' })).toContain('FN:Org');
  });
});

describe('other payloads', () => {
  it('builds mailto with encoded subject/body', () => {
    expect(buildEmailPayload('a@b.co', 'Hi there', 'x&y')).toBe('mailto:a@b.co?subject=Hi%20there&body=x%26y');
    expect(buildEmailPayload('a@b.co')).toBe('mailto:a@b.co');
  });
  it('builds tel and SMSTO', () => {
    expect(buildPhonePayload('+1 (555) 010-999')).toBe('tel:+1555010999');
    expect(buildSmsPayload('+44 20', 'On my way')).toBe('SMSTO:+4420:On my way');
    expect(() => buildPhonePayload('abc')).toThrow();
  });
});

describe('classifyDecoded', () => {
  it('detects URLs (http/https only)', () => {
    expect(classifyDecoded('https://example.com/a?b=1')).toMatchObject({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(classifyDecoded('javascript:alert(1)').kind).toBe('text');
    expect(classifyDecoded('www.example.com')).toMatchObject({ kind: 'url', url: 'https://www.example.com' });
  });
  it('detects Wi-Fi, vCard, email, phone, sms', () => {
    expect(classifyDecoded('WIFI:T:WPA;S:a;P:b;;').wifi?.ssid).toBe('a');
    expect(classifyDecoded('BEGIN:VCARD\r\nEND:VCARD').kind).toBe('vcard');
    expect(classifyDecoded('mailto:a@b.c').kind).toBe('email');
    expect(classifyDecoded('tel:123').kind).toBe('phone');
    expect(classifyDecoded('SMSTO:1:hi').kind).toBe('sms');
    expect(classifyDecoded('just words').kind).toBe('text');
  });
});
