import { describe, expect, it } from 'vitest';
import { audioBitrate, availableContainers, describeMime, pickFormat, videoBitrate } from './mime';

/** isTypeSupported stub that accepts exact strings or predicate matches. */
const supports = (...accepted: Array<string | RegExp>) => (t: string) => accepted.some((a) => (typeof a === 'string' ? a === t : a.test(t)));

// What real browsers report (approximately), as of 2025–2026.
const CHROME_WIN = supports(/^video\/mp4;codecs="?avc1/, /^video\/webm/, /^audio\/webm/, /^audio\/mp4/);
const CHROME_LINUX_NO_AAC = supports(/^video\/mp4;codecs="?avc1[^,]*"?$/, /^video\/mp4;codecs="?avc1.*opus/, /^video\/webm/, /^audio\/webm/);
const FIREFOX = supports(/^video\/webm/, /^audio\/webm/, /^audio\/ogg/);
const SAFARI = supports(/^video\/mp4/, /^audio\/mp4/);

describe('pickFormat', () => {
  it('prefers MP4 H.264 + AAC when supported', () => {
    const f = pickFormat({ video: true, audio: true, isTypeSupported: CHROME_WIN })!;
    expect(f.container).toBe('mp4');
    expect(f.mimeType).toMatch(/avc1.*mp4a\.40\.2/);
    expect(f.ext).toBe('mp4');
    expect(f.label).toBe('MP4 (H.264 + AAC)');
  });

  it('falls back to WebM VP9 + Opus when MP4 with AAC is missing', () => {
    const f = pickFormat({ video: true, audio: true, isTypeSupported: CHROME_LINUX_NO_AAC })!;
    expect(f.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(f.label).toBe('WebM (VP9 + Opus)');
    expect(f.ext).toBe('webm');
  });

  it('falls back to VP8 when VP9 is missing', () => {
    const f = pickFormat({ video: true, audio: true, isTypeSupported: supports('video/webm;codecs=vp8,opus', 'video/webm') })!;
    expect(f.mimeType).toBe('video/webm;codecs=vp8,opus');
    expect(f.videoCodec).toBe('VP8');
  });

  it('Firefox gets WebM VP9 + Opus', () => {
    expect(pickFormat({ video: true, audio: true, isTypeSupported: FIREFOX })!.mimeType).toBe('video/webm;codecs=vp9,opus');
  });

  it('Safari gets MP4', () => {
    const f = pickFormat({ video: true, audio: true, isTypeSupported: SAFARI })!;
    expect(f.container).toBe('mp4');
  });

  it('uses video-only codec strings when there is no audio track', () => {
    const f = pickFormat({ video: true, audio: false, isTypeSupported: FIREFOX })!;
    expect(f.mimeType).toBe('video/webm;codecs=vp9');
    expect(f.audioCodec).toBeNull();
  });

  it('honours a WebM preference', () => {
    const f = pickFormat({ video: true, audio: true, prefer: 'webm', isTypeSupported: CHROME_WIN })!;
    expect(f.container).toBe('webm');
  });

  it('ignores a preference the browser cannot satisfy', () => {
    expect(pickFormat({ video: true, audio: true, prefer: 'mp4', isTypeSupported: FIREFOX })!.container).toBe('webm');
  });

  it('audio only: Opus in WebM, then Ogg, then AAC in MP4', () => {
    expect(pickFormat({ video: false, audio: true, isTypeSupported: CHROME_WIN })!.mimeType).toBe('audio/webm;codecs=opus');
    expect(pickFormat({ video: false, audio: true, isTypeSupported: supports('audio/ogg;codecs=opus') })!.mimeType).toBe('audio/ogg;codecs=opus');
    const s = pickFormat({ video: false, audio: true, isTypeSupported: SAFARI })!;
    expect(s.mimeType).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(s.ext).toBe('m4a');
    expect(s.label).toBe('MP4 (AAC)');
  });

  it('returns null when nothing is supported, and survives a throwing isTypeSupported', () => {
    expect(pickFormat({ video: true, audio: true, isTypeSupported: () => false })).toBeNull();
    expect(
      pickFormat({
        video: true,
        audio: true,
        isTypeSupported: () => {
          throw new Error('boom');
        },
      }),
    ).toBeNull();
  });
});

describe('availableContainers', () => {
  it('lists containers the browser can record', () => {
    expect(availableContainers(true, CHROME_WIN)).toEqual(['mp4', 'webm']);
    expect(availableContainers(true, FIREFOX)).toEqual(['webm']);
    expect(availableContainers(true, SAFARI)).toEqual(['mp4']);
  });
});

describe('describeMime', () => {
  it('describes recorder MIME types', () => {
    expect(describeMime('video/webm;codecs=vp9,opus')).toMatchObject({ ext: 'webm', label: 'WebM (VP9 + Opus)', isVideo: true });
    expect(describeMime('video/mp4;codecs="avc1.640028,mp4a.40.2"')).toMatchObject({ ext: 'mp4', label: 'MP4 (H.264 + AAC)' });
    expect(describeMime('audio/mp4')).toMatchObject({ ext: 'm4a', isVideo: false });
    expect(describeMime('audio/ogg;codecs=opus')).toMatchObject({ ext: 'ogg', label: 'Ogg (Opus)' });
    expect(describeMime('video/x-matroska;codecs=avc1')).toMatchObject({ ext: 'mkv' });
  });
});

describe('bitrates', () => {
  it('scales with pixels and quality, rounded to 100 kbps', () => {
    const med1080 = videoBitrate(1920, 1080, 30, 'medium');
    expect(med1080).toBe(5_000_000);
    expect(videoBitrate(1920, 1080, 30, 'high')).toBeGreaterThan(med1080);
    expect(videoBitrate(1920, 1080, 30, 'low')).toBeLessThan(med1080);
    expect(videoBitrate(1280, 720, 30, 'medium')).toBeLessThan(med1080);
    expect(videoBitrate(1920, 1080, 60, 'medium')).toBe(7_500_000);
    expect(videoBitrate(1920, 1080, 30, 'medium') % 100_000).toBe(0);
  });
  it('clamps to sane bounds', () => {
    expect(videoBitrate(160, 90, 30, 'low')).toBe(500_000);
    expect(videoBitrate(7680, 4320, 60, 'high')).toBe(40_000_000);
  });
  it('audio presets', () => {
    expect(audioBitrate('low')).toBe(64_000);
    expect(audioBitrate('medium')).toBe(128_000);
    expect(audioBitrate('high')).toBe(192_000);
  });
});
