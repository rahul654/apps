/**
 * Builds Excalidraw elements in code (no Excalidraw import, so it runs in tests and on the
 * boards list). Produces the full element shape Excalidraw 0.18 writes, with fractional
 * indices, bound text labels and two-way arrow bindings.
 */
import type { SceneElement } from './types';

export const FONT = { excalifont: 5, nunito: 6, cascadia: 3 } as const;
export const INK = '#1e1e1e';
/** Excalidraw's own pastel fills. */
export const FILL = {
  blue: '#a5d8ff',
  green: '#b2f2bb',
  yellow: '#ffec99',
  violet: '#d0bfff',
  orange: '#ffd8a8',
  cyan: '#99e9f2',
  pink: '#fcc2d7',
  gray: '#e9ecef',
  lightGray: '#f8f9fa',
} as const;

export type ShapeType = 'rectangle' | 'ellipse' | 'diamond';
export type Point = [number, number];
type Side = 'top' | 'bottom' | 'left' | 'right';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** n-th key of an ascending sequence of valid fractional indices: a0…az, b00…bzz, c000…. */
export function fractionalIndex(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('index must be a non-negative integer');
  let digits = 1;
  let span = 62;
  let head = 'a'.charCodeAt(0);
  while (n >= span) {
    n -= span;
    digits++;
    span *= 62;
    head++;
  }
  let s = '';
  for (let i = 0; i < digits; i++) {
    s = BASE62[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return String.fromCharCode(head) + s;
}

/** Rough text box size; Excalidraw re-measures text once its fonts load. */
export function measureText(text: string, fontSize: number, lineHeight = 1.25): { width: number; height: number } {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => [...l].length), 1);
  return { width: Math.ceil(longest * fontSize * 0.56), height: Math.ceil(lines.length * fontSize * lineHeight) };
}

export interface ShapeOptions {
  label?: string;
  fill?: string;
  stroke?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  strokeWidth?: number;
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
  fontSize?: number;
  fontFamily?: number;
  rounded?: boolean;
  roughness?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle';
  groupIds?: string[];
}

export interface TextOptions {
  fontSize?: number;
  fontFamily?: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
  groupIds?: string[];
}

export interface ArrowOptions {
  label?: string;
  start?: Side;
  end?: Side;
  /** Absolute waypoints between the two ends. */
  via?: Point[];
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  stroke?: string;
  fontSize?: number;
  gap?: number;
}

/** A deterministic PRNG (mulberry32) so tests can pin ids and seeds. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SceneBuilder {
  readonly elements: SceneElement[] = [];
  private readonly rand: () => number;
  private readonly now: number;
  private readonly ids = new Set<string>();
  fontFamily: number = FONT.excalifont;
  roughness = 1;

  constructor(opts: { random?: () => number; now?: number } = {}) {
    this.rand = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now();
  }

  id(): string {
    for (;;) {
      let s = '';
      for (let i = 0; i < 20; i++) s += BASE62[Math.floor(this.rand() * 62)];
      if (!this.ids.has(s)) {
        this.ids.add(s);
        return s;
      }
    }
  }

  private int(): number {
    return Math.floor(this.rand() * 2 ** 31);
  }

  private push<T extends SceneElement>(el: T): T {
    (el as SceneElement).index = fractionalIndex(this.elements.length);
    this.elements.push(el);
    return el;
  }

  private base(type: string, x: number, y: number, width: number, height: number): SceneElement {
    return {
      id: this.id(),
      type,
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: INK,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: this.roughness,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: null,
      roundness: null,
      seed: this.int(),
      version: 1,
      versionNonce: this.int(),
      isDeleted: false,
      boundElements: [],
      updated: this.now,
      link: null,
      locked: false,
    };
  }

  shape(type: ShapeType, x: number, y: number, width: number, height: number, o: ShapeOptions = {}): SceneElement {
    const el = this.base(type, x, y, width, height);
    Object.assign(el, {
      backgroundColor: o.fill ?? 'transparent',
      strokeColor: o.stroke ?? INK,
      strokeStyle: o.strokeStyle ?? 'solid',
      strokeWidth: o.strokeWidth ?? 2,
      fillStyle: o.fillStyle ?? 'solid',
      roughness: o.roughness ?? this.roughness,
      groupIds: o.groupIds ?? [],
      roundness: type === 'ellipse' ? null : type === 'diamond' ? { type: 2 } : o.rounded === false ? null : { type: 3 },
    });
    this.push(el);
    if (o.label) this.label(el, o.label, o);
    return el;
  }

  /** Text bound inside a container (rectangle/ellipse/diamond/arrow). */
  label(container: SceneElement, text: string, o: ShapeOptions | ArrowOptions = {}): SceneElement {
    const fontSize = o.fontSize ?? 20;
    const fontFamily = ('fontFamily' in o && o.fontFamily) || this.fontFamily;
    const size = measureText(text, fontSize);
    const textAlign = ('textAlign' in o && o.textAlign) || 'center';
    const verticalAlign = ('verticalAlign' in o && o.verticalAlign) || 'middle';
    let cx: number;
    let cy: number;
    if (container.type === 'arrow') {
      const pts = container.points as Point[];
      const [a, b] = midSegment(pts);
      cx = (container.x as number) + (a[0] + b[0]) / 2;
      cy = (container.y as number) + (a[1] + b[1]) / 2;
    } else {
      cx = (container.x as number) + (container.width as number) / 2;
      cy = (container.y as number) + (container.height as number) / 2;
    }
    const pad = 10;
    const x = textAlign === 'left' && container.type !== 'arrow' ? (container.x as number) + pad : cx - size.width / 2;
    const y = verticalAlign === 'top' && container.type !== 'arrow' ? (container.y as number) + pad : cy - size.height / 2;
    const el = this.base('text', x, y, size.width, size.height);
    Object.assign(el, {
      strokeColor: (container.strokeColor as string) ?? INK,
      groupIds: [...((container.groupIds as string[]) ?? [])],
      text,
      originalText: text,
      fontSize,
      fontFamily,
      textAlign,
      verticalAlign,
      containerId: container.id,
      autoResize: true,
      lineHeight: 1.25,
    });
    this.push(el);
    (container.boundElements as { id: string; type: string }[]).push({ type: 'text', id: el.id });
    return el;
  }

  /** Free-standing text whose top-left is (x, y), or centred on x with align "center". */
  text(x: number, y: number, text: string, o: TextOptions = {}): SceneElement {
    const fontSize = o.fontSize ?? 20;
    const size = measureText(text, fontSize);
    const left = o.align === 'center' ? x - size.width / 2 : o.align === 'right' ? x - size.width : x;
    const el = this.base('text', left, y, size.width, size.height);
    Object.assign(el, {
      strokeColor: o.color ?? INK,
      groupIds: o.groupIds ?? [],
      text,
      originalText: text,
      fontSize,
      fontFamily: o.fontFamily ?? this.fontFamily,
      textAlign: o.align ?? 'left',
      verticalAlign: 'top',
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    });
    return this.push(el);
  }

  /** Unbound line or polyline through absolute points. */
  line(points: Point[], o: { strokeStyle?: 'solid' | 'dashed' | 'dotted'; stroke?: string; strokeWidth?: number; groupIds?: string[] } = {}): SceneElement {
    const el = this.linear('line', points);
    Object.assign(el, {
      strokeStyle: o.strokeStyle ?? 'solid',
      strokeColor: o.stroke ?? INK,
      strokeWidth: o.strokeWidth ?? 2,
      groupIds: o.groupIds ?? [],
      roundness: null,
      startArrowhead: null,
      endArrowhead: null,
    });
    return this.push(el);
  }

  private linear(type: 'line' | 'arrow', abs: Point[]): SceneElement {
    const [x0, y0] = abs[0];
    const points = abs.map(([x, y]) => [round(x - x0), round(y - y0)] as Point);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const el = this.base(type, x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    el.points = points;
    el.lastCommittedPoint = null;
    return el;
  }

  /** Arrow from shape `from` to shape `to`, bound at both ends (Excalidraw keeps it attached on move). */
  arrow(from: SceneElement, to: SceneElement, o: ArrowOptions = {}): SceneElement {
    const gap = o.gap ?? 6;
    const via = o.via ?? [];
    const aim = (el: SceneElement, side: Side | undefined, toward: Point): Point => (side ? sidePoint(el, side, gap) : edgePoint(el, toward, gap));
    const start = aim(from, o.start, via[0] ?? center(to));
    const end = aim(to, o.end, via[via.length - 1] ?? center(from));
    const el = this.linear('arrow', [start, ...via, end]);
    Object.assign(el, {
      strokeColor: o.stroke ?? INK,
      strokeStyle: o.strokeStyle ?? 'solid',
      roundness: via.length ? null : { type: 2 },
      startBinding: { elementId: from.id, focus: 0, gap },
      endBinding: { elementId: to.id, focus: 0, gap },
      startArrowhead: o.startArrowhead === undefined ? null : o.startArrowhead,
      endArrowhead: o.endArrowhead === undefined ? 'arrow' : o.endArrowhead,
      elbowed: false,
    });
    this.push(el);
    (from.boundElements as { id: string; type: string }[]).push({ type: 'arrow', id: el.id });
    (to.boundElements as { id: string; type: string }[]).push({ type: 'arrow', id: el.id });
    if (o.label) this.label(el, o.label, { fontSize: o.fontSize ?? 16 });
    return el;
  }

  /** Puts elements in a new group so they move together. */
  group(...els: SceneElement[]): string {
    const gid = this.id();
    for (const el of els) {
      (el.groupIds as string[]).push(gid);
      for (const b of (el.boundElements as { id: string; type: string }[]) ?? []) {
        const t = this.elements.find((e) => e.id === b.id && b.type === 'text');
        if (t) (t.groupIds as string[]).push(gid);
      }
    }
    return gid;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

export function center(el: SceneElement): Point {
  return [(el.x as number) + (el.width as number) / 2, (el.y as number) + (el.height as number) / 2];
}

function sidePoint(el: SceneElement, side: Side, gap: number): Point {
  const [cx, cy] = center(el);
  const hw = (el.width as number) / 2;
  const hh = (el.height as number) / 2;
  if (side === 'top') return [cx, cy - hh - gap];
  if (side === 'bottom') return [cx, cy + hh + gap];
  if (side === 'left') return [cx - hw - gap, cy];
  return [cx + hw + gap, cy];
}

/** Point on the outline of a rectangle/ellipse/diamond toward `target`, pushed out by `gap`. */
export function edgePoint(el: SceneElement, target: Point, gap: number): Point {
  const [cx, cy] = center(el);
  const hw = (el.width as number) / 2;
  const hh = (el.height as number) / 2;
  const dx = target[0] - cx;
  const dy = target[1] - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let t: number;
  if (el.type === 'ellipse') t = 1 / Math.hypot(ux / hw, uy / hh);
  else if (el.type === 'diamond') t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
  else t = Math.min(ux ? hw / Math.abs(ux) : Infinity, uy ? hh / Math.abs(uy) : Infinity);
  return [cx + ux * (t + gap), cy + uy * (t + gap)];
}

function midSegment(points: Point[]): [Point, Point] {
  if (points.length === 2) return [points[0], points[1]];
  // Label sits on the middle segment of a polyline.
  const i = Math.floor((points.length - 1) / 2);
  return [points[i], points[i + 1]];
}
