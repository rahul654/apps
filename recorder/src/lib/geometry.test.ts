import { describe, expect, it } from 'vitest';
import {
  bubbleFraction,
  bubbleRect,
  clampPosition,
  containRect,
  cornerPosition,
  coverCrop,
  dragPosition,
  nearestCorner,
  outputSize,
  type BubbleLayout,
} from './geometry';

const base: BubbleLayout = { shape: 'circle', size: 'm', x: 0, y: 0, mirror: false, border: false };

describe('bubble geometry', () => {
  it('sizes the bubble from the shorter side, independent of resolution', () => {
    const a = bubbleFraction('circle', 'm', 1920, 1080);
    const b = bubbleFraction('circle', 'm', 1280, 720);
    expect(a).toEqual(b);
    expect(a.fh).toBeCloseTo(0.28);
    expect(a.fw).toBeCloseTo((0.28 * 1080) / 1920);
    const r = bubbleFraction('rounded', 'm', 1920, 1080);
    expect(r.fw / r.fh).toBeCloseTo((4 / 3) * (1080 / 1920));
  });

  it('S < M < L', () => {
    const s = bubbleFraction('circle', 's', 1000, 1000).fh;
    const m = bubbleFraction('circle', 'm', 1000, 1000).fh;
    const l = bubbleFraction('circle', 'l', 1000, 1000).fh;
    expect(s).toBeLessThan(m);
    expect(m).toBeLessThan(l);
  });

  it('places the bubble in each corner with an equal pixel margin', () => {
    const W = 1920;
    const H = 1080;
    const { fw, fh } = bubbleFraction('circle', 'm', W, H);
    const tl = cornerPosition('tl', 'circle', 'm', W, H);
    const br = cornerPosition('br', 'circle', 'm', W, H);
    const tr = cornerPosition('tr', 'circle', 'm', W, H);
    const bl = cornerPosition('bl', 'circle', 'm', W, H);
    const margin = 0.035 * 1080;
    expect(tl.x * W).toBeCloseTo(margin);
    expect(tl.y * H).toBeCloseTo(margin);
    expect((1 - br.x - fw) * W).toBeCloseTo(margin);
    expect((1 - br.y - fh) * H).toBeCloseTo(margin);
    expect(tr).toEqual({ x: br.x, y: tl.y });
    expect(bl).toEqual({ x: tl.x, y: br.y });
    expect(nearestCorner(tl.x, tl.y, fw, fh)).toBe('tl');
    expect(nearestCorner(br.x, br.y, fw, fh)).toBe('br');
    expect(nearestCorner(tr.x, tr.y, fw, fh)).toBe('tr');
    expect(nearestCorner(bl.x, bl.y, fw, fh)).toBe('bl');
  });

  it('clamps positions so the bubble stays inside', () => {
    expect(clampPosition(-0.2, 1.5, 0.2, 0.3)).toEqual({ x: 0, y: 0.7 });
    expect(clampPosition(0.95, -1, 0.2, 0.3)).toEqual({ x: 0.8, y: 0 });
    expect(clampPosition(0.4, 0.4, 0.2, 0.3)).toEqual({ x: 0.4, y: 0.4 });
  });

  it('drags by pixel deltas in the preview and clamps', () => {
    // 800×450 preview, drag 80 px right / 45 px down = 0.1 of each axis.
    const p = dragPosition({ x: 0.2, y: 0.2 }, 80, 45, 800, 450, 0.2, 0.3);
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.3);
    expect(dragPosition({ x: 0.7, y: 0.6 }, 1000, 1000, 800, 450, 0.2, 0.3)).toEqual({ x: 0.8, y: 0.7 });
    expect(dragPosition({ x: 0.1, y: 0.1 }, -1000, -1000, 800, 450, 0.2, 0.3)).toEqual({ x: 0, y: 0 });
    expect(dragPosition({ x: 0.1, y: 0.1 }, 5, 5, 0, 0, 0.2, 0.3)).toEqual({ x: 0.1, y: 0.1 });
  });

  it('scales the same layout to any output size', () => {
    const layout = { ...base, ...cornerPosition('br', 'circle', 'm', 1920, 1080) };
    const big = bubbleRect(layout, 1920, 1080);
    const small = bubbleRect(layout, 1280, 720);
    expect(big.w).toBe(big.h);
    expect(big.radius).toBe(big.w / 2);
    expect(small.x / 1280).toBeCloseTo(big.x / 1920, 2);
    expect(small.w / 1280).toBeCloseTo(big.w / 1920, 2);
    expect(big.x + big.w).toBeLessThanOrEqual(1920);
    expect(big.y + big.h).toBeLessThanOrEqual(1080);
  });

  it('adds a border width only when enabled, and a smaller radius for rounded rects', () => {
    expect(bubbleRect(base, 1920, 1080).borderWidth).toBe(0);
    expect(bubbleRect({ ...base, border: true }, 1920, 1080).borderWidth).toBeGreaterThanOrEqual(2);
    const r = bubbleRect({ ...base, shape: 'rounded' }, 1920, 1080);
    expect(r.w / r.h).toBeCloseTo(4 / 3, 1);
    expect(r.radius).toBeLessThan(r.h / 2);
  });

  it('clamps a stored position that would fall outside a different aspect ratio', () => {
    const r = bubbleRect({ ...base, x: 0.95, y: 0.95, size: 'l' }, 1080, 1920);
    expect(r.x + r.w).toBeLessThanOrEqual(1080);
    expect(r.y + r.h).toBeLessThanOrEqual(1920);
  });
});

describe('contain / cover', () => {
  it('letterboxes a 4:3 source in 16:9', () => {
    expect(containRect(1024, 768, 1920, 1080)).toEqual({ x: 240, y: 0, w: 1440, h: 1080 });
    expect(containRect(1920, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(containRect(2560, 1080, 1920, 1080)).toEqual({ x: 0, y: 135, w: 1920, h: 810 });
  });
  it('centre-crops for cover', () => {
    expect(coverCrop(1280, 720, 100, 100)).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720 });
    expect(coverCrop(720, 1280, 100, 100)).toEqual({ sx: 0, sy: 280, sw: 720, sh: 720 });
    const c = coverCrop(640, 480, 400, 300);
    expect(c).toEqual({ sx: 0, sy: 0, sw: 640, sh: 480 });
  });
  it('handles zero sizes', () => {
    expect(containRect(0, 0, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(coverCrop(0, 0, 10, 10)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('outputSize', () => {
  it('never upscales and keeps even dimensions', () => {
    expect(outputSize(1280, 720, '1080')).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1365, 767, 'source')).toEqual({ width: 1364, height: 766 });
  });
  it('caps landscape sources inside 1920×1080 / 1280×720', () => {
    expect(outputSize(3840, 2160, '1080')).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(2560, 1440, '720')).toEqual({ width: 1280, height: 720 });
    // Ultrawide: width-limited.
    expect(outputSize(3440, 1440, '1080')).toEqual({ width: 1920, height: 802 });
    // 16:10 MacBook: height-limited.
    expect(outputSize(2880, 1800, '1080')).toEqual({ width: 1728, height: 1080 });
  });
  it('caps portrait sources inside 1080×1920', () => {
    expect(outputSize(1440, 2560, '1080')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(1080, 1920, '720')).toEqual({ width: 720, height: 1280 });
  });
  it('keeps aspect ratio within rounding', () => {
    const { width, height } = outputSize(2732, 2048, '720');
    expect(width / height).toBeCloseTo(2732 / 2048, 2);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });
  it('falls back for unknown sizes', () => {
    expect(outputSize(0, 0, '1080')).toEqual({ width: 1280, height: 720 });
  });
});
