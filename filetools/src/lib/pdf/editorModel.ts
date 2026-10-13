/**
 * Data model for the PDF editor. All coordinates are in *display space* of the page
 * (points, top-left origin, after the page's /Rotate) — see lib/coords.ts.
 */

import { scaleSizes, type Paragraph } from '../text/model';

interface Base {
  id: string;
  /** 0-based page index. */
  page: number;
}

/** Rich text box: paragraphs of styled runs, wrapped to width `w`. Height comes from layout. */
export interface TextObj extends Base {
  type: 'text';
  x: number;
  y: number;
  /** Box width in points (text wraps). */
  w: number;
  paragraphs: Paragraph[];
  background: string | null;
  padding: number;
  /** 0–1 */
  opacity: number;
}

export interface ShapeObj extends Base {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
}

export interface CoverObj extends Base {
  type: 'cover';
  x: number;
  y: number;
  w: number;
  h: number;
  color: 'white' | 'black';
  /** Secure redaction: flatten the whole page to an image on save. */
  secure: boolean;
}

export interface LineObj extends Base {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  arrow: boolean;
  opacity: number;
}

export interface PathObj extends Base {
  type: 'path';
  /** Flat [x0, y0, x1, y1, …]. */
  points: number[];
  color: string;
  width: number;
  opacity: number;
  highlighter: boolean;
}

export interface ImageObj extends Base {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  imageId: string;
  signature: boolean;
}

export type EditorObject = TextObj | ShapeObj | CoverObj | LineObj | PathObj | ImageObj;

/** Two barb end points of an arrow head at (x2, y2). */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): [number, number, number, number] {
  const len = Math.max(8, width * 4);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    x2 - len * Math.cos(a - spread),
    y2 - len * Math.sin(a - spread),
    x2 - len * Math.cos(a + spread),
    y2 - len * Math.sin(a + spread),
  ];
}

/**
 * Smooth SVG path through points using quadratic curves between midpoints
 * (the classic "smooth freehand" trick). Same string is used on screen and in the PDF.
 */
export function smoothPath(points: number[]): string {
  const n = points.length / 2;
  if (n === 0) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  if (n === 1) return `M ${f(points[0])} ${f(points[1])} L ${f(points[0] + 0.01)} ${f(points[1])}`;
  if (n === 2) return `M ${f(points[0])} ${f(points[1])} L ${f(points[2])} ${f(points[3])}`;
  let d = `M ${f(points[0])} ${f(points[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const mx = (x + points[i * 2 + 2]) / 2;
    const my = (y + points[i * 2 + 3]) / 2;
    d += ` Q ${f(x)} ${f(y)} ${f(mx)} ${f(my)}`;
  }
  d += ` L ${f(points[(n - 1) * 2])} ${f(points[(n - 1) * 2 + 1])}`;
  return d;
}

/** Axis-aligned bounds of an object in display space. */
/** Size of a text box (width, layout height). Without a measurer, a rough estimate. */
export type TextSizer = (t: TextObj) => { w: number; h: number };

export function estimateTextHeight(t: TextObj): number {
  return t.paragraphs.reduce((s, p) => s + Math.max(...p.runs.map((r) => r.marks.size)) * p.lineHeight * Math.max(1, p.runs.map((r) => r.text).join('').split('\n').length), 0) + 2 * t.padding;
}

export function objectBounds(o: EditorObject, measureText?: TextSizer): { x: number; y: number; w: number; h: number } {
  switch (o.type) {
    case 'text': {
      const m = measureText?.(o) ?? { w: o.w, h: estimateTextHeight(o) };
      return { x: o.x, y: o.y, w: m.w, h: m.h };
    }
    case 'line': {
      const x = Math.min(o.x1, o.x2);
      const y = Math.min(o.y1, o.y2);
      return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    }
    case 'path': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < o.points.length; i += 2) {
        minX = Math.min(minX, o.points[i]);
        maxX = Math.max(maxX, o.points[i]);
        minY = Math.min(minY, o.points[i + 1]);
        maxY = Math.max(maxY, o.points[i + 1]);
      }
      const pad = o.width / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
    }
    default:
      return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

/** Move an object by (dx, dy). Returns a new object. */
export function translateObject<T extends EditorObject>(o: T, dx: number, dy: number): T {
  switch (o.type) {
    case 'line':
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    case 'path':
      return { ...o, points: o.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    default:
      return { ...o, x: (o as { x: number }).x + dx, y: (o as { y: number }).y + dy };
  }
}

/** Parse "#rrggbb" or "#rgb" into 0–1 channels. */
export function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export type FormValue = string | boolean;

export interface FormFieldInfo {
  /** Unique key for this widget in the UI. */
  key: string;
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist';
  page: number;
  /** Display-space rect of the widget. */
  rect: { x: number; y: number; w: number; h: number };
  value: FormValue;
  /** For radio widgets: the option this widget selects. */
  option?: string;
  options?: string[];
  multiline?: boolean;
  readOnly: boolean;
  maxLength?: number;
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w' | 'p1' | 'p2';

/**
 * Resize an object by dragging a handle by (dx, dy) display points.
 * Boxes keep the opposite corner fixed (and aspect ratio for images); text boxes change
 * width with the side handles (text re-wraps) and scale width + font sizes with the
 * corner handle; lines move the dragged end point. Paths can't be resized.
 */
export function resizeObject<T extends EditorObject>(o: T, handle: ResizeHandle, dx: number, dy: number): T {
  const MIN = 4;
  if (o.type === 'line') {
    return (handle === 'p1' ? { ...o, x1: o.x1 + dx, y1: o.y1 + dy } : { ...o, x2: o.x2 + dx, y2: o.y2 + dy }) as T;
  }
  if (o.type === 'text') {
    const MIN_W = 16;
    if (handle === 'e') return { ...o, w: Math.max(MIN_W, o.w + dx) } as T;
    if (handle === 'w') {
      const w = Math.max(MIN_W, o.w - dx);
      return { ...o, x: o.x + o.w - w, w } as T;
    }
    const factor = Math.max(0.15, (o.w + dx) / Math.max(1, o.w));
    return { ...o, w: Math.max(MIN_W, o.w * factor), paragraphs: scaleSizes(o.paragraphs, factor), padding: o.padding * factor } as T;
  }
  if (o.type === 'path') return o;
  let { x, y, w, h } = o as unknown as { x: number; y: number; w: number; h: number };
  const right = x + w;
  const bottom = y + h;
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  let nw = west ? w - dx : w + dx;
  let nh = north ? h - dy : h + dy;
  if (o.type === 'image') {
    const ratio = w / h;
    const scale = Math.max(nw / w, nh / h);
    nw = Math.max(MIN, w * scale);
    nh = nw / ratio;
  }
  nw = Math.max(MIN, nw);
  nh = Math.max(MIN, nh);
  x = west ? right - nw : x;
  y = north ? bottom - nh : y;
  return { ...o, x, y, w: nw, h: nh } as T;
}
