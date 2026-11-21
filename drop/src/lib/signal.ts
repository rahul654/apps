/**
 * Pairing codes: the few parts of a WebRTC offer/answer that matter, packed into ~100 bytes so
 * they fit a QR code that scans instantly. The receiving side rebuilds a full SDP from them.
 *
 * A data-channel-only SDP carries just: ICE credentials (ufrag + pwd), the DTLS certificate
 * fingerprint (proves which device we talk to), the DTLS role, the SCTP max message size and the
 * network addresses ("candidates"). Everything else is fixed for our single data channel.
 *
 * Binary layout (version 1), all integers big-endian:
 *   u8   (version << 4) | (answer ? 0x08 : 0) | setup (0 actpass, 1 active, 2 passive)
 *   u8   ufrag length, then ASCII bytes
 *   u8   pwd length, then ASCII bytes
 *   32   SHA-256 certificate fingerprint
 *   u32  max-message-size (0 = not given)
 *   u8   candidate count, then per candidate:
 *        u8  (address kind << 2) | type   kind: 0 IPv4, 1 IPv6, 2 mDNS name (<uuid>.local)
 *                                          type: 0 host, 1 srflx, 2 prflx, 3 relay
 *        4 / 16 / 16 bytes of address, then u16 port
 */
import { fromBase64Url, toBase64Url } from './base64url';

export const SIGNAL_VERSION = 1;
export const MAX_CANDIDATES = 8;

export type Setup = 'actpass' | 'active' | 'passive';
export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface Candidate {
  /** IPv4 dotted, IPv6 (any valid form) or `<uuid>.local`. */
  address: string;
  port: number;
  type: CandidateType;
}

export interface Signal {
  kind: 'offer' | 'answer';
  setup: Setup;
  ufrag: string;
  pwd: string;
  /** SHA-256 certificate fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  /** SCTP max-message-size; 0 when the SDP didn't say (the spec default is 64 KiB). */
  maxMessageSize: number;
  candidates: Candidate[];
}

/** A pairing code that can't be used, with a message fit for the UI. */
export class SignalError extends Error {}

const SETUPS: Setup[] = ['actpass', 'active', 'passive'];
const TYPES: CandidateType[] = ['host', 'srflx', 'prflx', 'relay'];
const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// ---------- addresses ----------

function parseIpv4(s: string): number[] | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** IPv6 text → 16 bytes, or null. Handles `::` compression and a trailing dotted IPv4. */
export function parseIpv6(s: string): Uint8Array | null {
  let text = s.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!text.includes(':')) return null;
  const tailV4 = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tailV4) {
    const v4 = parseIpv4(tailV4[1]);
    if (!v4) return null;
    text = `${text.slice(0, -tailV4[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    const v = parseInt(groups[i], 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

function formatIpv6(b: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((b[i] << 8) | b[i + 1]).toString(16));
  return groups.join(':');
}

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Addresses no other device can reach: loopback, unspecified, IPv6 link-local. */
function unusable(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return v4[0] === 127 || v4[0] === 0;
  const v6 = parseIpv6(address);
  if (v6) {
    const loopbackOrZero = v6.slice(0, 15).every((x) => x === 0);
    const linkLocal = v6[0] === 0xfe && (v6[1] & 0xc0) === 0x80;
    return loopbackOrZero || linkLocal;
  }
  return false;
}

// ---------- SDP → Signal ----------

/** Read the parts we need from a browser's local SDP. */
export function parseSdp(sdp: string, kind: Signal['kind']): Signal {
  const lines = sdp.split(/\r?\n/);
  const attr = (name: string) => lines.find((l) => l.startsWith(`a=${name}:`))?.slice(name.length + 3).trim();
  const ufrag = attr('ice-ufrag');
  const pwd = attr('ice-pwd');
  const fpLine = attr('fingerprint');
  const setup = (attr('setup') ?? (kind === 'offer' ? 'actpass' : 'active')) as Setup;
  if (!ufrag || !pwd || !fpLine) throw new SignalError('The browser produced an incomplete connection description.');
  const [algo, fpHex] = fpLine.split(/\s+/);
  if (algo.toLowerCase() !== 'sha-256' || !fpHex) throw new SignalError(`This browser uses an unsupported certificate fingerprint (${algo}).`);
  const fingerprint = new Uint8Array(fpHex.split(':').map((h) => parseInt(h, 16)));
  if (fingerprint.length !== 32 || fingerprint.some((x) => Number.isNaN(x))) throw new SignalError('Invalid certificate fingerprint.');
  if (!SETUPS.includes(setup)) throw new SignalError(`Unsupported DTLS role "${setup}".`);
  const mms = Number(attr('max-message-size') ?? 0);

  const candidates: Candidate[] = [];
  for (const line of lines) {
    // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> …
    const m = /^a=candidate:\S+ (\d+) (\S+) \d+ (\S+) (\d+) typ (\S+)/.exec(line);
    if (!m || m[1] !== '1' || m[2].toLowerCase() !== 'udp') continue;
    const [address, port, type] = [m[3], Number(m[4]), m[5] as CandidateType];
    if (!TYPES.includes(type) || !(port > 0 && port < 65536) || unusable(address)) continue;
    if (!parseIpv4(address) && !parseIpv6(address) && !MDNS.test(address)) continue;
    if (candidates.some((c) => c.address === address && c.port === port)) continue;
    candidates.push({ address, port, type });
  }
  return { kind, setup, ufrag, pwd, fingerprint, maxMessageSize: Number.isFinite(mms) ? mms : 0, candidates: candidates.slice(0, MAX_CANDIDATES) };
}

// ---------- Signal ⇄ bytes ----------

export function encodeSignal(s: Signal): Uint8Array {
  const out: number[] = [];
  const u8 = (n: number) => out.push(n & 0xff);
  const u16 = (n: number) => out.push((n >> 8) & 0xff, n & 0xff);
  const u32 = (n: number) => out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const str = (t: string) => {
    if (t.length > 255 || !/^[\x21-\x7e]*$/.test(t)) throw new SignalError('Unexpected ICE credential.');
    u8(t.length);
    for (const ch of t) out.push(ch.charCodeAt(0));
  };
  u8((SIGNAL_VERSION << 4) | (s.kind === 'answer' ? 0x08 : 0) | SETUPS.indexOf(s.setup));
  str(s.ufrag);
  str(s.pwd);
  if (s.fingerprint.length !== 32) throw new SignalError('Invalid certificate fingerprint.');
  out.push(...s.fingerprint);
  u32(Math.min(s.maxMessageSize, 0xffffffff));
  const cands = s.candidates.slice(0, MAX_CANDIDATES);
  u8(cands.length);
  for (const c of cands) {
    const type = TYPES.indexOf(c.type);
    const v4 = parseIpv4(c.address);
    const mdns = MDNS.exec(c.address);
    const v6 = v4 || mdns ? null : parseIpv6(c.address);
    if (v4) {
      u8((0 << 2) | type);
      out.push(...v4);
    } else if (v6) {
      u8((1 << 2) | type);
      out.push(...v6);
    } else if (mdns) {
      u8((2 << 2) | type);
      const h = mdns.slice(1).join('');
      for (let i = 0; i < 32; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
    } else {
      throw new SignalError(`Can't encode address ${c.address}.`);
    }
    u16(c.port);
  }
  return new Uint8Array(out);
}

export function decodeSignal(bytes: Uint8Array): Signal {
  let i = 0;
  const need = (n: number) => {
    if (i + n > bytes.length) throw new SignalError('This code is incomplete. Scan it again or copy the whole code.');
  };
  const u8 = () => (need(1), bytes[i++]);
  const u16 = () => (need(2), (bytes[i++] << 8) | bytes[i++]);
  const u32 = () => (need(4), ((bytes[i++] << 24) | (bytes[i++] << 16) | (bytes[i++] << 8) | bytes[i++]) >>> 0);
  const take = (n: number) => (need(n), bytes.slice(i, (i += n)));
  const str = () => String.fromCharCode(...take(u8()));

  // Smallest valid code: header, 1-char ufrag and pwd, fingerprint, max size, 0 candidates.
  if (bytes.length < 1 + 2 + 2 + 32 + 4 + 1) throw new SignalError('This isn’t a Drop code, or only part of one. Scan it again or copy the whole code.');
  const head = u8();
  if (head >> 4 !== SIGNAL_VERSION) throw new SignalError('This code comes from a different version of Drop. Reload both pages and try again.');
  const setup = SETUPS[head & 0x03];
  if (!setup) throw new SignalError('This isn’t a valid Drop code.');
  const kind: Signal['kind'] = head & 0x08 ? 'answer' : 'offer';
  const ufrag = str();
  const pwd = str();
  if (!ufrag || !pwd) throw new SignalError('This isn’t a valid Drop code.');
  const fingerprint = take(32);
  const maxMessageSize = u32();
  const count = u8();
  if (count > MAX_CANDIDATES) throw new SignalError('This isn’t a valid Drop code.');
  const candidates: Candidate[] = [];
  for (let n = 0; n < count; n++) {
    const h = u8();
    const type = TYPES[h & 0x03];
    const addrKind = h >> 2;
    let address: string;
    if (addrKind === 0) address = [...take(4)].join('.');
    else if (addrKind === 1) address = formatIpv6(take(16));
    else if (addrKind === 2) {
      const x = hex(take(16));
      address = `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}.local`;
    } else throw new SignalError('This isn’t a valid Drop code.');
    candidates.push({ address, port: u16(), type });
  }
  if (i !== bytes.length) throw new SignalError('This isn’t a valid Drop code.');
  return { kind, setup, ufrag, pwd, fingerprint, maxMessageSize, candidates };
}

// ---------- Signal → SDP ----------

/** ICE priority (RFC 8445 §5.1.2.1): type preference, then the order the peer listed them in. */
function priority(type: CandidateType, index: number): number {
  const typePref = { host: 126, prflx: 110, srflx: 100, relay: 0 }[type];
  return typePref * 2 ** 24 + (65535 - index) * 2 ** 8 + 255;
}

/** A complete remote SDP for our single negotiated data channel. */
export function buildSdp(s: Signal): string {
  const sessionId = Array.from({ length: 18 }, (_, k) => (k === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10))).join('');
  const fp = [...s.fingerprint].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const lines = [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...s.candidates.map(
      (c, idx) => `a=candidate:${idx + 1} 1 udp ${priority(c.type, idx)} ${c.address} ${c.port} typ ${c.type}${c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0'}`,
    ),
    'a=end-of-candidates',
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${s.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    ...(s.maxMessageSize ? [`a=max-message-size:${s.maxMessageSize}`] : []),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- codes and links ----------

export const JOIN_ROUTE = '/j/';

export function signalToCode(s: Signal): string {
  return toBase64Url(encodeSignal(s));
}

/**
 * Accepts a bare code, or a whole join link (`…/drop/#/j/<code>`), with stray whitespace from
 * copy-paste. Throws SignalError with a UI-ready message.
 */
export function codeToSignal(input: string): Signal {
  const text = input.replace(/\s+/g, '');
  const at = text.indexOf(`#${JOIN_ROUTE}`);
  const code = at >= 0 ? text.slice(at + JOIN_ROUTE.length + 1).split(/[?#&]/)[0] : text;
  if (!code) throw new SignalError('Paste or scan a Drop code.');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(code);
  } catch {
    throw new SignalError('This isn’t a Drop code.');
  }
  return decodeSignal(bytes);
}

/** The link the other device opens: this page with the code in the hash (never sent to the server). */
export function joinLink(pageUrl: string, code: string): string {
  return `${pageUrl.split('#')[0]}#${JOIN_ROUTE}${code}`;
}
