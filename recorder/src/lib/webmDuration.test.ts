import { readFileSync } from 'node:fs';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { patchWebmDuration, patchWebmHead, readWebmDuration } from './webmDuration';

/*
 * Fixtures (src/lib/__fixtures__), all real encoder output:
 *  - live-seekhead.webm : ffmpeg `-live 1` (VP8 + Opus, 2 s). Unknown-size Segment, SeekHead
 *                         with positions, Void, Info without Duration. Same shape as libwebm /
 *                         Firefox live output.
 *  - chrome-layout.webm : the same file reduced to Chrome MediaRecorder's layout:
 *                         EBML, Segment(unknown), Info(no Duration), Tracks, Clusters.
 *  - with-duration.webm : normal ffmpeg output (known Segment size, Duration 1 s, Cues).
 */
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

async function mediabunnyDuration(bytes: Uint8Array): Promise<number | null> {
  const input = new Input({ source: new BufferSource(bytes.slice().buffer), formats: ALL_FORMATS });
  return input.getDurationFromMetadata();
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function applyPatch(file: Uint8Array, ms: number): Uint8Array {
  const r = patchWebmHead(file.subarray(0, 64 * 1024), ms);
  expect(r).not.toBeNull();
  return concat(r!.bytes, file.subarray(r!.consumed));
}

describe('WebM duration patch', () => {
  it('fixtures start without a duration', () => {
    expect(readWebmDuration(fixture('chrome-layout.webm'))).toBeNull();
    expect(readWebmDuration(fixture('live-seekhead.webm'))).toBeNull();
    expect(readWebmDuration(fixture('with-duration.webm'))).toBeCloseTo(1000, 0);
  });

  it('inserts Duration into a Chrome-layout file', async () => {
    const src = fixture('chrome-layout.webm');
    const out = applyPatch(src, 2000);
    expect(out.length).toBe(src.length + 11);
    expect(readWebmDuration(out)).toBeCloseTo(2000, 6);
    // An independent parser agrees and the rest of the file is intact.
    expect(await mediabunnyDuration(out)).toBeCloseTo(2, 3);
    expect(out.subarray(out.length - 2000)).toEqual(src.subarray(src.length - 2000));
  });

  it('shifts SeekHead positions after the inserted bytes', async () => {
    const src = fixture('live-seekhead.webm');
    const out = applyPatch(src, 1999.5);
    expect(readWebmDuration(out)).toBeCloseTo(1999.5, 6);
    expect(await mediabunnyDuration(out)).toBeCloseTo(1.9995, 3);
    // Every SeekHead entry must still point at the element it names.
    const seekTargets = findSeekEntries(out);
    expect(seekTargets.length).toBeGreaterThan(1);
    for (const { target, position } of seekTargets) {
      expect(readIdAt(out, segmentDataStart(out) + position)).toBe(target);
    }
  });

  it('overwrites an existing Duration in place', async () => {
    const src = fixture('with-duration.webm');
    const out = applyPatch(src, 4321);
    expect(out.length).toBe(src.length);
    expect(readWebmDuration(out)).toBeCloseTo(4321, 3);
    expect(await mediabunnyDuration(out)).toBeCloseTo(4.321, 2);
  });

  it('grows a known Segment size', () => {
    // Give the Chrome-layout file a known Segment size (8-byte vint, as libwebm writes it).
    const src = fixture('chrome-layout.webm').slice();
    const sizePos = 0x28; // EBML header is 0x24 bytes, then the 4-byte Segment ID.
    const dataStart = sizePos + 8;
    const known = src.length - dataStart;
    src[sizePos] = 0x01;
    for (let i = 7, v = known; i >= 1; i--, v = Math.floor(v / 256)) src[sizePos + i] = v % 256;
    const out = applyPatch(src, 1500);
    let size = 0; // first byte of an 8-byte vint is just the 0x01 marker
    for (let i = 1; i < 8; i++) size = size * 256 + out[sizePos + i];
    expect(size).toBe(known + 11);
    expect(readWebmDuration(out)).toBeCloseTo(1500, 6);
  });

  it('works on a Blob without reading the whole file', async () => {
    const src = fixture('chrome-layout.webm');
    const blob = new Blob([src], { type: 'video/webm' });
    const patched = await patchWebmDuration(blob, 2000);
    expect(patched).not.toBeNull();
    expect(patched!.type).toBe('video/webm');
    expect(patched!.size).toBe(blob.size + 11);
    const bytes = new Uint8Array(await patched!.arrayBuffer());
    expect(readWebmDuration(bytes)).toBeCloseTo(2000, 6);
  });

  it('refuses non-WebM data and bad durations', () => {
    expect(patchWebmHead(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), 1000)).toBeNull(); // MP4-ish
    expect(patchWebmHead(new Uint8Array(0), 1000)).toBeNull();
    expect(patchWebmHead(fixture('chrome-layout.webm'), 0)).toBeNull();
    expect(patchWebmHead(fixture('chrome-layout.webm'), NaN)).toBeNull();
    // Truncated header (Info cut off) must not be "patched".
    expect(patchWebmHead(fixture('chrome-layout.webm').subarray(0, 60), 1000)).toBeNull();
  });

  it('is idempotent: patching twice overwrites', () => {
    const once = applyPatch(fixture('chrome-layout.webm'), 1000);
    const twice = applyPatch(once, 3000);
    expect(twice.length).toBe(once.length);
    expect(readWebmDuration(twice)).toBeCloseTo(3000, 6);
  });
});

// --- tiny EBML helpers for assertions ---
function vintAt(b: Uint8Array, pos: number) {
  const f = b[pos];
  let l = 1;
  while (!(f & (0x80 >> (l - 1)))) l++;
  let v = f & (0xff >> l);
  for (let i = 1; i < l; i++) v = v * 256 + b[pos + i];
  return { v, l };
}
function readIdAt(b: Uint8Array, pos: number) {
  const f = b[pos];
  let l = 1;
  while (!(f & (0x80 >> (l - 1)))) l++;
  let v = 0;
  for (let i = 0; i < l; i++) v = v * 256 + b[pos + i];
  return v;
}
function idLen(b: Uint8Array, pos: number) {
  let l = 1;
  while (!(b[pos] & (0x80 >> (l - 1)))) l++;
  return l;
}
function segmentDataStart(b: Uint8Array) {
  const el = idLen(b, 0);
  const s = vintAt(b, el);
  const segPos = el + s.l + s.v;
  return segPos + idLen(b, segPos) + vintAt(b, segPos + idLen(b, segPos)).l;
}
function findSeekEntries(b: Uint8Array) {
  const out: Array<{ target: number; position: number }> = [];
  let pos = segmentDataStart(b);
  const il = idLen(b, pos);
  if (readIdAt(b, pos) !== 0x114d9b74) return out;
  const sz = vintAt(b, pos + il);
  const end = pos + il + sz.l + sz.v;
  pos += il + sz.l;
  while (pos < end) {
    const sl = idLen(b, pos);
    const ssz = vintAt(b, pos + sl);
    let p = pos + sl + ssz.l;
    const seekEnd = p + ssz.v;
    let target = 0;
    let position = 0;
    while (p < seekEnd) {
      const fid = readIdAt(b, p);
      const fl = idLen(b, p);
      const fs = vintAt(b, p + fl);
      const data = p + fl + fs.l;
      let v = 0;
      for (let i = 0; i < fs.v; i++) v = v * 256 + b[data + i];
      if (fid === 0x53ab) target = v;
      if (fid === 0x53ac) position = v;
      p = data + fs.v;
    }
    out.push({ target, position });
    pos = seekEnd;
  }
  return out;
}
