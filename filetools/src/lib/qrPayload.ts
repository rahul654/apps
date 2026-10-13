/** Builders and parsers for the common QR payload formats. */

export type WifiEncryption = 'WPA' | 'WEP' | 'nopass';

export interface WifiConfig {
  ssid: string;
  password: string;
  encryption: WifiEncryption;
  hidden: boolean;
}

/** Escape special characters for WIFI: / MECARD payloads: \ ; , : " */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

export function buildWifiPayload(cfg: WifiConfig): string {
  if (!cfg.ssid) throw new Error('Network name (SSID) is required.');
  const parts = [`T:${cfg.encryption === 'nopass' ? 'nopass' : cfg.encryption}`, `S:${escapeWifi(cfg.ssid)}`];
  if (cfg.encryption !== 'nopass') parts.push(`P:${escapeWifi(cfg.password)}`);
  if (cfg.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

/** Split on an unescaped separator, keeping escapes intact. */
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
    if (c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function unescapeBackslashes(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

/** Parse a WIFI: payload. Returns null if it isn't one. */
export function parseWifiPayload(text: string): WifiConfig | null {
  if (!/^WIFI:/i.test(text.trim())) return null;
  const body = text.trim().slice(5);
  const fields: Record<string, string> = {};
  for (const field of splitUnescaped(body, ';')) {
    if (!field) continue;
    const idx = (() => {
      for (let i = 0; i < field.length; i++) {
        if (field[i] === '\\') { i++; continue; }
        if (field[i] === ':') return i;
      }
      return -1;
    })();
    if (idx <= 0) continue;
    const key = field.slice(0, idx).toUpperCase();
    if (!(key in fields)) fields[key] = unescapeBackslashes(field.slice(idx + 1));
  }
  if (fields.S === undefined) return null;
  const t = (fields.T ?? '').toUpperCase();
  const encryption: WifiEncryption = t === 'WEP' ? 'WEP' : t === '' || t === 'NOPASS' ? (fields.P ? 'WPA' : 'nopass') : 'WPA';
  return {
    ssid: fields.S,
    password: fields.P ?? '',
    encryption,
    hidden: (fields.H ?? '').toLowerCase() === 'true',
  };
}

export interface ContactCard {
  firstName: string;
  lastName: string;
  organization?: string;
  title?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  street?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
  note?: string;
}

/** Escape text values in vCard 3.0 (RFC 2426): backslash, comma, semicolon, newline. */
export function escapeVCard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildVCard(c: ContactCard): string {
  if (!c.firstName.trim() && !c.lastName.trim() && !c.organization?.trim()) {
    throw new Error('Enter at least a name or organisation.');
  }
  const e = escapeVCard;
  const fn = [c.firstName, c.lastName].map((s) => s.trim()).filter(Boolean).join(' ') || c.organization!.trim();
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${e(c.lastName.trim())};${e(c.firstName.trim())};;;`, `FN:${e(fn)}`];
  if (c.organization?.trim()) lines.push(`ORG:${e(c.organization.trim())}`);
  if (c.title?.trim()) lines.push(`TITLE:${e(c.title.trim())}`);
  if (c.mobile?.trim()) lines.push(`TEL;TYPE=CELL:${e(c.mobile.trim())}`);
  if (c.phone?.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${e(c.phone.trim())}`);
  if (c.email?.trim()) lines.push(`EMAIL:${e(c.email.trim())}`);
  if (c.website?.trim()) lines.push(`URL:${e(c.website.trim())}`);
  const adr = [c.street, c.city, c.region, c.postcode, c.country].map((s) => e(s?.trim() ?? ''));
  if (adr.some(Boolean)) lines.push(`ADR;TYPE=WORK:;;${adr.join(';')}`);
  if (c.note?.trim()) lines.push(`NOTE:${e(c.note.trim())}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function buildEmailPayload(to: string, subject = '', body = ''): string {
  if (!to.trim()) throw new Error('Email address is required.');
  const q: string[] = [];
  if (subject) q.push(`subject=${encodeURIComponent(subject)}`);
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to.trim()}${q.length ? `?${q.join('&')}` : ''}`;
}

export function buildPhonePayload(number: string): string {
  const n = number.replace(/[^\d+*#]/g, '');
  if (!n) throw new Error('Phone number is required.');
  return `tel:${n}`;
}

export function buildSmsPayload(number: string, message = ''): string {
  const n = number.replace(/[^\d+*#]/g, '');
  if (!n) throw new Error('Phone number is required.');
  return message ? `SMSTO:${n}:${message}` : `SMSTO:${n}`;
}

export type DecodedKind = 'url' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms' | 'geo' | 'text';

export interface Decoded {
  kind: DecodedKind;
  text: string;
  /** Safe http(s) URL to open, if any. */
  url?: string;
  wifi?: WifiConfig;
}

/** Classify scanned text so the UI can offer the right actions. */
export function classifyDecoded(text: string): Decoded {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol === 'http:' || u.protocol === 'https:') return { kind: 'url', text, url: u.href };
    } catch {
      /* not a URL */
    }
  }
  const wifi = parseWifiPayload(t);
  if (wifi) return { kind: 'wifi', text, wifi };
  if (/^BEGIN:VCARD/i.test(t) || /^MECARD:/i.test(t)) return { kind: 'vcard', text };
  if (/^(mailto:|MATMSG:)/i.test(t)) return { kind: 'email', text };
  if (/^tel:/i.test(t)) return { kind: 'phone', text };
  if (/^(smsto:|sms:)/i.test(t)) return { kind: 'sms', text };
  if (/^geo:/i.test(t)) return { kind: 'geo', text };
  if (/^www\.\S+\.\S+$/i.test(t)) return { kind: 'url', text, url: `https://${t}` };
  return { kind: 'text', text };
}
