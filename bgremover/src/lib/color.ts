export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const COLOR_PRESETS: readonly { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#000000' },
  { name: 'Light grey', hex: '#f1f3f5' },
  { name: 'Studio blue', hex: '#dbe8ff' },
  { name: 'Mint', hex: '#d8f5e6' },
  { name: 'Butter', hex: '#fff3c4' },
  { name: 'Blush', hex: '#ffe0e6' },
  { name: 'Charcoal', hex: '#2b2f36' },
];

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Parses #rgb, #rrggbb, rgb(r, g, b) / rgb(r g b) with 0–255 or percentage channels.
 * Returns null for anything else. Alpha in the input is ignored (backgrounds are opaque).
 */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean).slice(0, 3);
    if (parts.length !== 3) return null;
    const vals = parts.map((p) => {
      if (/^-?\d+(\.\d+)?%$/.test(p)) return (parseFloat(p) / 100) * 255;
      if (/^-?\d+(\.\d+)?$/.test(p)) return parseFloat(p);
      return NaN;
    });
    if (vals.some((v) => Number.isNaN(v))) return null;
    return { r: clamp255(vals[0]), g: clamp255(vals[1]), b: clamp255(vals[2]) };
  }
  return null;
}

export const toHex = ({ r, g, b }: RGB) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

/** Normalises any accepted colour string to #rrggbb, or returns the fallback. */
export const normalizeHex = (input: string, fallback = '#ffffff') => {
  const c = parseColor(input);
  return c ? toHex(c) : fallback;
};

/** Relative luminance (sRGB), used to pick a readable swatch outline. */
export function luminance({ r, g, b }: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
