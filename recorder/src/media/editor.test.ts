/**
 * Runs the real Mediabunny trim (packet copy, no WebCodecs needed) on fixture files in Node.
 * Precise trims and conversions need WebCodecs encoders and are verified in the browser.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readWebmDuration } from '../lib/webmDuration';
import { capabilities, keyFrameBefore, probe, trim } from './editor';

const fixture = (name: string, type: string) => new Blob([readFileSync(new URL(`../lib/__fixtures__/${name}`, import.meta.url))], { type });

describe('editor (Mediabunny)', () => {
  it('probes a MediaRecorder-style WebM without a duration header', async () => {
    const info = await probe(fixture('chrome-layout.webm', 'video/webm'));
    expect(info.container).toBe('webm');
    expect(info.duration).toBeGreaterThan(1.8);
    expect(info.video).toMatchObject({ codec: 'vp8', width: 96, height: 54 });
    expect(info.audio?.codec).toBe('opus');
  });

  it('probes a fragmented MP4 (Chrome MediaRecorder MP4 layout)', async () => {
    const info = await probe(fixture('fragmented.mp4', 'video/mp4'));
    expect(info.container).toBe('mp4');
    expect(info.duration).toBeCloseTo(3, 0);
    expect(info.video?.codec).toBe('avc');
    expect(info.audio?.codec).toBe('aac');
  });

  it('reports no conversions when WebCodecs is missing (Node)', async () => {
    const caps = await capabilities(await probe(fixture('chrome-layout.webm', 'video/webm')));
    expect(caps.canTrim).toBe(true);
    expect(caps.toWebm).toBeNull(); // already WebM
    if (typeof VideoEncoder === 'undefined') expect(caps.toMp4).toBeNull();
  });

  it('finds the key frame before a time', async () => {
    const blob = fixture('chrome-layout.webm', 'video/webm');
    const k = await keyFrameBefore(blob, 1.45);
    expect(k).not.toBeNull();
    expect(k!).toBeLessThanOrEqual(1.45);
    expect(k!).toBeGreaterThanOrEqual(0.4); // GOP is 1 s
  });

  it('fast-trims WebM by copying packets, with a real duration in the output', async () => {
    const r = await trim(fixture('chrome-layout.webm', 'video/webm'), { start: 1.05, end: 1.9 }, 'fast');
    expect(r.mimeType).toMatch(/^video\/webm/);
    expect(r.transcoded).toBe(false);
    // Starts at the previous key frame (~1.0 s), so the clip is a bit longer than requested.
    expect(r.duration).toBeGreaterThan(0.8);
    expect(r.duration).toBeLessThan(1.3);
    const head = new Uint8Array(await r.blob.slice(0, 4096).arrayBuffer());
    expect(readWebmDuration(head)).toBeGreaterThan(800);
    const again = await probe(r.blob);
    expect(again.video?.codec).toBe('vp8');
    expect(again.audio?.codec).toBe('opus');
    await r.cleanup();
  });

  it('fast-trims a fragmented MP4 into a regular MP4', async () => {
    const r = await trim(fixture('fragmented.mp4', 'video/mp4'), { start: 1, end: 2.5 }, 'fast');
    expect(r.mimeType).toMatch(/^video\/mp4/);
    expect(r.transcoded).toBe(false);
    expect(r.duration).toBeCloseTo(1.5, 0);
    const again = await probe(r.blob);
    expect(again.video?.codec).toBe('avc');
    expect(again.audio?.codec).toBe('aac');
  });

  it('can be cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(trim(fixture('fragmented.mp4', 'video/mp4'), { start: 0.5, end: 2 }, 'fast', { signal: ac.signal })).rejects.toBeTruthy();
  });
});
