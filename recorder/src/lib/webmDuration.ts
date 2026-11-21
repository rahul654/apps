/**
 * WebM duration fix.
 *
 * MediaRecorder writes WebM as a live stream: the Segment has "unknown" size and the
 * Info element has no Duration, so players show no length and can't seek. This module
 * inserts (or overwrites) Segment › Info › Duration in the header.
 *
 * Only the first few hundred bytes are touched: the result is
 * `[patched header bytes, original.slice(consumed)]`, so a multi-GB recording is never
 * read into memory.
 *
 * Handled layouts:
 *  - Chrome / Edge: EBML, Segment(unknown size), Info, Tracks, Cluster… (no SeekHead)
 *  - Firefox and libwebm/ffmpeg live output: SeekHead before Info (positions are shifted)
 *  - Segment with a known size (size is increased in place)
 *  - Info that already has a Duration (overwritten in place, nothing shifts)
 * Bails out (returns null) rather than writing a broken file when it can't be sure,
 * e.g. when a SeekHead points to Cues that live after the header.
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114d9b74;
const ID_SEEK = 0x4dbb;
const ID_SEEK_ID = 0x53ab;
const ID_SEEK_POSITION = 0x53ac;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;
const ID_CUES = 0x1c53bb6b;

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

function readVint(buf: Uint8Array, pos: number): Vint | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) return null; // > 8 bytes: invalid for WebM
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i];
    if (b !== 0xff) allOnes = false;
    value = value * 256 + b;
  }
  return { value, length, unknown: allOnes };
}

function readId(buf: Uint8Array, pos: number): { id: number; length: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i];
  return { id, length };
}

interface Element {
  id: number;
  /** Offset of the ID. */
  start: number;
  /** Offset of the size field. */
  sizeStart: number;
  sizeLength: number;
  /** Offset of the data. */
  dataStart: number;
  /** Data size; NaN when unknown. */
  size: number;
  /** Offset after the element (NaN when size unknown). */
  end: number;
}

function readElement(buf: Uint8Array, pos: number): Element | null {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readVint(buf, pos + id.length);
  if (!size) return null;
  const dataStart = pos + id.length + size.length;
  const s = size.unknown ? NaN : size.value;
  return { id: id.id, start: pos, sizeStart: pos + id.length, sizeLength: size.length, dataStart, size: s, end: dataStart + s };
}

function children(buf: Uint8Array, el: Element): Element[] {
  const out: Element[] = [];
  let pos = el.dataStart;
  const end = Math.min(el.end, buf.length);
  while (pos < end) {
    const c = readElement(buf, pos);
    if (!c || !Number.isFinite(c.end) || c.end > end) break;
    out.push(c);
    pos = c.end;
  }
  return out;
}

function readUint(buf: Uint8Array, start: number, length: number): number {
  let v = 0;
  for (let i = 0; i < length; i++) v = v * 256 + buf[start + i];
  return v;
}

function writeUint(buf: Uint8Array, start: number, length: number, value: number): boolean {
  if (value < 0 || value >= 2 ** (8 * length)) return false;
  for (let i = length - 1; i >= 0; i--) {
    buf[start + i] = value % 256;
    value = Math.floor(value / 256);
  }
  return true;
}

/** EBML size vint with exactly `length` bytes. Returns false if the value doesn't fit. */
function writeSizeVint(buf: Uint8Array, start: number, length: number, value: number): boolean {
  // All-ones is reserved for "unknown", so the max is 2^(7·len) − 2.
  if (length < 1 || length > 8 || value < 0 || value > 2 ** (7 * length) - 2) return false;
  for (let i = length - 1; i >= 1; i--) {
    buf[start + i] = value % 256;
    value = Math.floor(value / 256);
  }
  buf[start] = (0x80 >> (length - 1)) | value;
  return true;
}

function sizeVintLength(value: number): number {
  for (let len = 1; len <= 8; len++) if (value <= 2 ** (7 * len) - 2) return len;
  throw new RangeError('EBML size too large');
}

interface HeaderInfo {
  segment: Element;
  info: Element;
  timecodeScale: number;
  duration: Element | null;
  seekPositions: Array<{ target: number; start: number; length: number }>;
  seekHeadEnd: number;
  seeksToCues: boolean;
}

function parseHeader(buf: Uint8Array): HeaderInfo | null {
  const ebml = readElement(buf, 0);
  if (!ebml || ebml.id !== ID_EBML || !Number.isFinite(ebml.end)) return null;
  const segment = readElement(buf, ebml.end);
  if (!segment || segment.id !== ID_SEGMENT) return null;

  let info: Element | null = null;
  const seekPositions: HeaderInfo['seekPositions'] = [];
  let seekHeadEnd = 0;
  let seeksToCues = false;
  let pos = segment.dataStart;
  while (pos < buf.length) {
    const el = readElement(buf, pos);
    if (!el) return null;
    if (el.id === ID_CLUSTER) break;
    if (!Number.isFinite(el.end) || el.end > buf.length) {
      // An element we can't fully see. Fine if we already have Info and it's not a SeekHead.
      if (el.id === ID_SEEKHEAD || !info) return null;
      break;
    }
    if (el.id === ID_INFO) info = el;
    if (el.id === ID_SEEKHEAD) {
      seekHeadEnd = el.end;
      for (const seek of children(buf, el)) {
        if (seek.id !== ID_SEEK) continue;
        let target = 0;
        let position: { start: number; length: number } | null = null;
        for (const f of children(buf, seek)) {
          if (f.id === ID_SEEK_ID) target = readUint(buf, f.dataStart, f.size);
          if (f.id === ID_SEEK_POSITION) position = { start: f.dataStart, length: f.size };
        }
        if (target === ID_CUES) seeksToCues = true;
        if (position) seekPositions.push({ target, ...position });
      }
    }
    pos = el.end;
    if (info && seekHeadEnd && pos > Math.max(info.end, seekHeadEnd)) break;
  }
  if (!info) return null;

  let timecodeScale = 1_000_000;
  let duration: Element | null = null;
  for (const c of children(buf, info)) {
    if (c.id === ID_TIMECODE_SCALE && c.size > 0 && c.size <= 8) timecodeScale = readUint(buf, c.dataStart, c.size) || 1_000_000;
    if (c.id === ID_DURATION) duration = c;
  }
  return { segment, info, timecodeScale, duration, seekPositions, seekHeadEnd, seeksToCues };
}

function readFloat(buf: Uint8Array, el: Element): number | null {
  const dv = new DataView(buf.buffer, buf.byteOffset + el.dataStart, el.size);
  if (el.size === 8) return dv.getFloat64(0);
  if (el.size === 4) return dv.getFloat32(0);
  return null;
}

/** Duration in ms stored in the header, or null when absent (e.g. raw MediaRecorder output). */
export function readWebmDuration(head: Uint8Array): number | null {
  const h = parseHeader(head);
  if (!h || !h.duration) return null;
  const v = readFloat(head, h.duration);
  if (v === null || !Number.isFinite(v)) return null;
  return (v * h.timecodeScale) / 1_000_000;
}

/**
 * Patches the header bytes. Returns the replacement for `head.subarray(0, consumed)`, or
 * null if the data isn't a WebM header this function can patch safely.
 */
export function patchWebmHead(head: Uint8Array, durationMs: number): { bytes: Uint8Array; consumed: number } | null {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) return null;
  const h = parseHeader(head);
  if (!h) return null;
  const value = (durationMs * 1_000_000) / h.timecodeScale;

  // Case 1: a Duration element already exists. Overwrite in place.
  if (h.duration && (h.duration.size === 8 || h.duration.size === 4)) {
    const out = head.slice(0, h.duration.end);
    const dv = new DataView(out.buffer, h.duration.dataStart, h.duration.size);
    if (h.duration.size === 8) dv.setFloat64(0, value);
    else dv.setFloat32(0, value);
    return { bytes: out, consumed: h.duration.end };
  }
  if (h.duration) return null; // malformed Duration

  // Case 2: insert Duration (float64) at the end of Info.
  if (h.seeksToCues) return null; // Cues positions live after the header; can't shift them.
  const info = h.info;
  const body = head.subarray(info.dataStart, info.end);
  const durationEl = new Uint8Array(11);
  durationEl[0] = 0x44;
  durationEl[1] = 0x89;
  durationEl[2] = 0x88;
  new DataView(durationEl.buffer).setFloat64(3, value);
  const newBodyLen = body.length + durationEl.length;
  const sizeLen = Math.max(info.sizeLength, sizeVintLength(newBodyLen));
  const idLen = info.sizeStart - info.start;
  const newInfo = new Uint8Array(idLen + sizeLen + newBodyLen);
  newInfo.set(head.subarray(info.start, info.sizeStart), 0);
  if (!writeSizeVint(newInfo, idLen, sizeLen, newBodyLen)) return null;
  newInfo.set(body, idLen + sizeLen);
  newInfo.set(durationEl, idLen + sizeLen + body.length);
  const delta = newInfo.length - (info.end - info.start);

  const consumed = Math.max(info.end, h.seekHeadEnd);
  const out = new Uint8Array(consumed + delta);
  out.set(head.subarray(0, info.start), 0);
  out.set(newInfo, info.start);
  out.set(head.subarray(info.end, consumed), info.start + newInfo.length);

  // Known segment size grows by delta (same vint width).
  if (Number.isFinite(h.segment.size)) {
    if (!writeSizeVint(out, h.segment.sizeStart, h.segment.sizeLength, h.segment.size + delta)) return null;
  }

  // SeekHead positions are relative to the segment data start. Anything after Info moves.
  const infoRel = info.start - h.segment.dataStart;
  for (const sp of h.seekPositions) {
    const at = sp.start < info.start ? sp.start : sp.start + delta;
    const old = readUint(head, sp.start, sp.length);
    if (old > infoRel && !writeUint(out, at, sp.length, old + delta)) return null;
  }
  return { bytes: out, consumed };
}

/** Number of header bytes to read before patching. Headers are a few hundred bytes. */
export const HEAD_BYTES = 64 * 1024;

/** Returns a new Blob with the duration written, or null if it couldn't be patched. */
export async function patchWebmDuration(blob: Blob, durationMs: number): Promise<Blob | null> {
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, HEAD_BYTES)).arrayBuffer());
  const r = patchWebmHead(head, durationMs);
  if (!r) return null;
  return new Blob([r.bytes as Uint8Array<ArrayBuffer>, blob.slice(r.consumed)], { type: blob.type });
}

export function isWebm(mime: string): boolean {
  return /webm|matroska/i.test(mime);
}
