// Color parsing and conversion: HEX, RGB, HSL, OKLCH; WCAG contrast.

export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface OKLCH {
  l: number; // 0-1
  c: number; // ≥ 0
  h: number; // 0-360
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

// ---------- sRGB <-> HSL ----------

export function rgbToHsl({ r, g, b }: RGBA): HSL {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number, a = 1): RGBA {
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  const H = (((h % 360) + 360) % 360) / 60;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const X = C * (1 - Math.abs((H % 2) - 1));
  const m = L - C / 2;
  const [r, g, b] = H < 1 ? [C, X, 0] : H < 2 ? [X, C, 0] : H < 3 ? [0, C, X] : H < 4 ? [0, X, C] : H < 5 ? [X, 0, C] : [C, 0, X];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

// ---------- sRGB <-> OKLab/OKLCH (Björn Ottosson) ----------

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: RGBA): OKLCH {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + Bb * Bb);
  let H = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: C < 1e-4 ? 0 : H };
}

/** OKLCH → sRGB. `inGamut` is false when the colour had to be clipped to sRGB. */
export function oklchToRgb(L: number, C: number, H: number, a = 1): { rgb: RGBA; inGamut: boolean } {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const Bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const eps = 2e-3; // tolerate rounding in printed OKLCH values of sRGB-edge colours
  const inGamut = [R, G, Bl].every((v) => v >= -eps && v <= 1 + eps);
  return { rgb: { r: clamp(fromLinear(R), 0, 255), g: clamp(fromLinear(G), 0, 255), b: clamp(fromLinear(Bl), 0, 255), a }, inGamut };
}

// ---------- Parsing ----------

export interface ParsedColor {
  rgb: RGBA;
  /** False when an OKLCH input is outside sRGB and was clipped. */
  inGamut: boolean;
}

function parseHex(s: string): RGBA | null {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255, 3) : 1 };
}

/** Split "rgb(1 2 3 / 50%)" or "rgb(1, 2, 3, 0.5)" into [args, alpha]. */
function fnArgs(s: string, names: string[]): { args: string[]; alpha?: string } | null {
  const m = /^([a-z]+)\((.*)\)$/i.exec(s);
  if (!m || !names.includes(m[1].toLowerCase())) return null;
  const body = m[2].trim();
  let args: string[];
  let alpha: string | undefined;
  if (body.includes(',')) {
    args = body.split(',').map((x) => x.trim());
    if (args.length === 4) alpha = args.pop();
  } else {
    const [main, a] = body.split('/');
    args = main.trim().split(/\s+/);
    alpha = a?.trim();
  }
  if (args.length !== 3 || args.some((x) => x === '')) return null;
  return { args, alpha };
}

function num(x: string): number | null {
  const v = Number(x);
  return x.trim() !== '' && Number.isFinite(v) ? v : null;
}

function parseAlpha(x: string | undefined): number | null {
  if (x === undefined) return 1;
  if (x.endsWith('%')) {
    const v = num(x.slice(0, -1));
    return v === null ? null : clamp(v / 100, 0, 1);
  }
  const v = num(x);
  return v === null ? null : clamp(v, 0, 1);
}

function parseHue(x: string): number | null {
  const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|turn|rad|grad)?$/i.exec(x);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] ?? 'deg').toLowerCase();
  const deg = unit === 'turn' ? v * 360 : unit === 'rad' ? (v * 180) / Math.PI : unit === 'grad' ? v * 0.9 : v;
  return ((deg % 360) + 360) % 360;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  indigo: '#4b0082',
  rebeccapurple: '#663399',
  transparent: '#00000000',
};

export function parseColor(input: string): ParsedColor | null {
  const s = input.trim().toLowerCase();
  if (s === '') return null;
  if (NAMED[s]) return { rgb: parseHex(NAMED[s])!, inGamut: true };
  const hex = parseHex(s);
  if (hex) return { rgb: hex, inGamut: true };

  const rgb = fnArgs(s, ['rgb', 'rgba']);
  if (rgb) {
    const ch = rgb.args.map((x) => (x.endsWith('%') ? (v => (v === null ? null : (v / 100) * 255))(num(x.slice(0, -1))) : num(x)));
    const a = parseAlpha(rgb.alpha);
    if (ch.some((v) => v === null) || a === null) return null;
    const [r, g, b] = ch.map((v) => clamp(v!, 0, 255));
    return { rgb: { r, g, b, a }, inGamut: true };
  }

  const hsl = fnArgs(s, ['hsl', 'hsla']);
  if (hsl) {
    const h = parseHue(hsl.args[0]);
    const sat = num(hsl.args[1].replace('%', ''));
    const lig = num(hsl.args[2].replace('%', ''));
    const a = parseAlpha(hsl.alpha);
    if (h === null || sat === null || lig === null || a === null) return null;
    return { rgb: hslToRgb(h, sat, lig, a), inGamut: true };
  }

  const ok = fnArgs(s, ['oklch']);
  if (ok) {
    const [lt, ct, ht] = ok.args;
    const L = lt.endsWith('%') ? num(lt.slice(0, -1)) : num(lt);
    const C = ct.endsWith('%') ? (v => (v === null ? null : (v / 100) * 0.4))(num(ct.slice(0, -1))) : num(ct);
    const H = ht === 'none' ? 0 : parseHue(ht);
    const a = parseAlpha(ok.alpha);
    if (L === null || C === null || H === null || a === null) return null;
    const { rgb: out, inGamut } = oklchToRgb(lt.endsWith('%') ? L / 100 : L, Math.max(0, C), H, a);
    return { rgb: out, inGamut };
  }
  return null;
}

// ---------- Formatting ----------

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

export function toHex(c: RGBA): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ''}`;
}

const alphaSuffix = (a: number, modern: boolean) => (a < 1 ? (modern ? ` / ${round(a, 3)}` : `, ${round(a, 3)}`) : '');

export function toRgbString(c: RGBA): string {
  const [r, g, b] = [c.r, c.g, c.b].map((v) => Math.round(v));
  return c.a < 1 ? `rgba(${r}, ${g}, ${b}${alphaSuffix(c.a, false)})` : `rgb(${r}, ${g}, ${b})`;
}

export function toHslString(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c);
  const body = `${round(h, 1)}, ${round(s, 1)}%, ${round(l, 1)}%`;
  return c.a < 1 ? `hsla(${body}${alphaSuffix(c.a, false)})` : `hsl(${body})`;
}

export function toOklchString(c: RGBA): string {
  const { l, c: ch, h } = rgbToOklch(c);
  return `oklch(${round(l * 100, 2)}% ${round(ch, 4)} ${round(h, 2)}${alphaSuffix(c.a, true)})`;
}

// ---------- WCAG contrast ----------

export function relativeLuminance(c: RGBA): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function wcagLevel(ratio: number, large = false): 'AAA' | 'AA' | 'Fail' {
  if (ratio >= (large ? 4.5 : 7)) return 'AAA';
  if (ratio >= (large ? 3 : 4.5)) return 'AA';
  return 'Fail';
}
