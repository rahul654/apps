import type { Viewport } from '../types';

export interface ViewportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** CSS-pixel viewports. 'fill' and 'custom' are handled specially. */
export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: 'fill', label: 'Fill window', width: 0, height: 0 },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852 },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915 },
  { id: 'ipad-mini', label: 'iPad mini', width: 768, height: 1024 },
  { id: 'ipad-air', label: 'iPad Air', width: 820, height: 1180 },
  { id: 'laptop', label: 'Laptop', width: 1366, height: 768 },
  { id: 'desktop', label: 'Desktop HD', width: 1920, height: 1080 },
  { id: 'custom', label: 'Custom size', width: 0, height: 0 },
];

export const MIN_SIZE = 120;
export const MAX_SIZE = 4000;

export function clampSize(n: number): number {
  if (!Number.isFinite(n)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

/** The frame's CSS size, or null to fill the stage. */
export function frameSize(vp: Viewport): { width: number; height: number } | null {
  if (vp.preset === 'fill') return null;
  const preset = VIEWPORT_PRESETS.find((p) => p.id === vp.preset);
  const base =
    preset && preset.id !== 'custom'
      ? { width: preset.width, height: preset.height }
      : { width: clampSize(vp.width), height: clampSize(vp.height) };
  return vp.landscape ? { width: base.height, height: base.width } : base;
}

/** Scale that makes `frame` fit inside `avail` (never enlarges). 1 when not fitting or not measured yet. */
export function fitScale(
  frame: { width: number; height: number },
  avail: { width: number; height: number },
  fit: boolean,
): number {
  if (!fit || avail.width <= 0 || avail.height <= 0) return 1;
  const s = Math.min(1, avail.width / frame.width, avail.height / frame.height);
  return Math.max(0.1, s);
}
