// Base64 helpers that are UTF-8 safe (btoa/atob alone only handle Latin-1).

const encoder = new TextEncoder();

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text) as Uint8Array<ArrayBuffer>;
}

/** Strict UTF-8 decode; returns null if the bytes are not valid UTF-8. */
export function utf8DecodeStrict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export class Base64Error extends Error {}

/** Decode standard or URL-safe base64, tolerating whitespace and missing padding. */
export function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  let s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    const bad = /[^A-Za-z0-9+/=]/.exec(s);
    throw new Base64Error(bad ? `Invalid character ${JSON.stringify(bad[0])} in base64 input` : 'Padding (=) is only allowed at the end');
  }
  s = s.replace(/=+$/, '');
  if (s.length % 4 === 1) throw new Base64Error('Invalid base64 length (one character too many or too few)');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeTextBase64(text: string, urlSafe = false): string {
  return bytesToBase64(utf8Encode(text), urlSafe);
}

/** Decode base64 to text. `text` is null when the decoded bytes are not valid UTF-8 (binary data). */
export function decodeBase64Text(input: string): { bytes: Uint8Array<ArrayBuffer>; text: string | null } {
  const bytes = base64ToBytes(stripDataUrl(input));
  return { bytes, text: utf8DecodeStrict(bytes) };
}

export interface DataUrl {
  mime: string;
  isBase64: boolean;
  data: string;
}

export function parseDataUrl(input: string): DataUrl | null {
  const m = /^\s*data:([^,]*?),(.*)$/s.exec(input);
  if (!m) return null;
  const meta = m[1].split(';');
  const isBase64 = meta.includes('base64');
  const mime = meta[0] || 'text/plain';
  return { mime, isBase64, data: m[2] };
}

/** If the input is a base64 data URL, return just its payload. */
export function stripDataUrl(input: string): string {
  const d = parseDataUrl(input);
  return d && d.isBase64 ? d.data : input;
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

const SIGNATURES: { mime: string; ext: string; bytes: (number | null)[]; offset?: number }[] = [
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
  { mime: 'image/bmp', ext: 'bmp', bytes: [0x42, 0x4d] },
  { mime: 'image/x-icon', ext: 'ico', bytes: [0x00, 0x00, 0x01, 0x00] },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: 'application/zip', ext: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/gzip', ext: 'gz', bytes: [0x1f, 0x8b] },
  { mime: 'audio/mpeg', ext: 'mp3', bytes: [0x49, 0x44, 0x33] },
  { mime: 'video/mp4', ext: 'mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'application/wasm', ext: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
];

/** Guess a file type from magic bytes. */
export function sniffMime(bytes: Uint8Array): { mime: string; ext: string } | null {
  for (const sig of SIGNATURES) {
    const off = sig.offset ?? 0;
    if (bytes.length < off + sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => b === null || bytes[off + i] === b)) return { mime: sig.mime, ext: sig.ext };
  }
  if (bytes.length > 0 && utf8DecodeStrict(bytes.subarray(0, 4096)) !== null) {
    const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return { mime: 'image/svg+xml', ext: 'svg' };
    if (head.startsWith('{') || head.startsWith('[')) return { mime: 'application/json', ext: 'json' };
    return { mime: 'text/plain', ext: 'txt' };
  }
  return null;
}

const MIME_EXT: Record<string, string> = Object.fromEntries(SIGNATURES.map((s) => [s.mime, s.ext]));
Object.assign(MIME_EXT, { 'image/svg+xml': 'svg', 'application/json': 'json', 'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv' });

export function extensionForMime(mime: string): string {
  return MIME_EXT[mime] ?? 'bin';
}

/** Hex dump preview, e.g. "89 50 4e 47 …". */
export function hexPreview(bytes: Uint8Array, max = 64): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, max); i++) parts.push(bytes[i].toString(16).padStart(2, '0'));
  return parts.join(' ') + (bytes.length > max ? ' …' : '');
}
