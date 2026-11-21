/**
 * Screenshot annotations: the data model and its geometry (hit-testing, moving, resizing).
 *
 * Everything is in source-image pixels, so a scene renders identically at any display size
 * and the export is drawn by the same code as the editor (media/annotateRender.ts).
 * The original capture is never modified; the scene is stored next to it and can be edited again.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Translucent marker box. */
export interface HighlightAnn extends Rect {
  id: string;
  type: 'highlight';
  color: string;
}
/** Dims everything outside the spotlight boxes (several boxes = one combined hole). */
export interface SpotlightAnn extends Rect {
  id: string;
  type: 'spotlight';
}
export interface RectAnn extends Rect {
  id: string;
  type: 'rect';
  color: string;
  width: number;
}
/** Hides part of the screenshot: pixelated, or a solid box. Always drawn under other marks. */
export interface BlurAnn extends Rect {
  id: string;
  type: 'blur';
  style: 'pixelate' | 'solid';
}
export interface ArrowAnn {
  id: string;
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}
export interface PenAnn {
  id: string;
  type: 'pen';
  /** Flat [x0, y0, x1, y1, …]. */
  points: number[];
  color: string;
  width: number;
}
/** Text box; `w`/`h` are measured by the renderer when the text or size changes. */
export interface TextAnn extends Rect {
  id: string;
  type: 'text';
  text: string;
  color: string;
  size: number;
}

export type Annotation = HighlightAnn | SpotlightAnn | RectAnn | BlurAnn | ArrowAnn | PenAnn | TextAnn;
export type BoxAnnotation = HighlightAnn | SpotlightAnn | RectAnn | BlurAnn;

export interface Scene {
  annotations: Annotation[];
  /** Non-destructive crop in image pixels; null = whole image. */
  crop: Rect | null;
}

export const EMPTY_SCENE: Scene = { annotations: [], crop: null };

export type ToolId = 'select' | 'highlight' | 'spotlight' | 'rect' | 'arrow' | 'pen' | 'text' | 'blur' | 'crop';

/** Swatches offered for marks. Prefs only accept these. */
export const COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#111827', '#ffffff'] as const;
export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#fb923c'] as const;
export type MarkSize = 's' | 'm' | 'l';

const isBox = (a: Annotation): a is BoxAnnotation => a.type === 'highlight' || a.type === 'spotlight' || a.type === 'rect' || a.type === 'blur';

/** Scale factor so marks look the same on a 720p and a 4K capture. */
export function styleUnit(imageW: number, imageH: number): number {
  return Math.max(1, Math.min(imageW, imageH) / 1080);
}

export function strokeWidth(size: MarkSize, unit: number): number {
  return Math.round({ s: 3, m: 5, l: 9 }[size] * unit);
}

export function textSize(size: MarkSize, unit: number): number {
  return Math.round({ s: 20, m: 30, l: 46 }[size] * unit);
}

/**
 * Pixel block for "pixelate". Coarse on purpose (at least 12 px, about a sixteenth of the
 * box), so the text underneath can't be read back; "solid" is the safest choice for secrets.
 */
export function pixelBlock(r: Rect): number {
  return Math.round(Math.min(48, Math.max(12, Math.max(Math.abs(r.w), Math.abs(r.h)) / 16)));
}

/** Rectangle spanned by two points (any drag direction). */
export function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Intersection with the image; null when nothing is left. */
export function clampRect(r: Rect, imageW: number, imageH: number): Rect | null {
  const x1 = Math.max(0, Math.min(imageW, r.x));
  const y1 = Math.max(0, Math.min(imageH, r.y));
  const x2 = Math.max(0, Math.min(imageW, r.x + r.w));
  const y2 = Math.max(0, Math.min(imageH, r.y + r.h));
  if (x2 - x1 < 1 || y2 - y1 < 1) return null;
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

/** The part of the image that is shown and exported. */
export function viewRect(scene: Scene, imageW: number, imageH: number): Rect {
  return (scene.crop && clampRect(scene.crop, imageW, imageH)) ?? { x: 0, y: 0, w: imageW, h: imageH };
}

export function bounds(a: Annotation): Rect {
  if (a.type === 'arrow') return normRect({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 });
  if (a.type === 'pen') {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i + 1 < a.points.length; i += 2) {
      x1 = Math.min(x1, a.points[i]);
      x2 = Math.max(x2, a.points[i]);
      y1 = Math.min(y1, a.points[i + 1]);
      y2 = Math.max(y2, a.points[i + 1]);
    }
    return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : { x: 0, y: 0, w: 0, h: 0 };
  }
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

/** Distance from p to the segment a–b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const inside = (p: Pt, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

/** Whether p (image px) touches the annotation; `tol` is the grab distance in image px. */
export function hits(a: Annotation, p: Pt, tol: number): boolean {
  switch (a.type) {
    case 'rect': {
      // Outline only, so marks inside a box stay selectable.
      const pad = tol + a.width / 2;
      return inside(p, a, pad) && !inside({ x: p.x, y: p.y }, { x: a.x + pad, y: a.y + pad, w: a.w - 2 * pad, h: a.h - 2 * pad });
    }
    case 'arrow':
      return distToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= tol + a.width / 2;
    case 'pen': {
      const pts = a.points;
      if (pts.length === 2) return Math.hypot(p.x - pts[0], p.y - pts[1]) <= tol + a.width / 2;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (distToSegment(p, { x: pts[i], y: pts[i + 1] }, { x: pts[i + 2], y: pts[i + 3] }) <= tol + a.width / 2) return true;
      }
      return false;
    }
    default:
      return inside(p, a, tol / 2);
  }
}

/** Topmost annotation under p. Marks win over the spotlight / blur layers drawn beneath them. */
export function hitTest(anns: readonly Annotation[], p: Pt, tol: number): Annotation | null {
  const layered = (a: Annotation) => a.type === 'spotlight' || a.type === 'blur';
  for (let i = anns.length - 1; i >= 0; i--) if (!layered(anns[i]) && hits(anns[i], p, tol)) return anns[i];
  for (let i = anns.length - 1; i >= 0; i--) if (layered(anns[i]) && hits(anns[i], p, tol)) return anns[i];
  return null;
}

export type HandleId = 'nw' | 'ne' | 'sw' | 'se' | 'p1' | 'p2';

export function handlesFor(a: Annotation | Rect): Array<{ id: HandleId } & Pt> {
  if ('type' in a) {
    if (a.type === 'arrow') return [{ id: 'p1', x: a.x1, y: a.y1 }, { id: 'p2', x: a.x2, y: a.y2 }];
    if (!isBox(a)) return [];
  }
  const r = a as Rect;
  return [
    { id: 'nw', x: r.x, y: r.y },
    { id: 'ne', x: r.x + r.w, y: r.y },
    { id: 'sw', x: r.x, y: r.y + r.h },
    { id: 'se', x: r.x + r.w, y: r.y + r.h },
  ];
}

export function hitHandle(a: Annotation | Rect, p: Pt, tol: number): HandleId | null {
  for (const h of handlesFor(a)) if (Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol) return h.id;
  return null;
}

/** A box dragged by one corner: the opposite corner stays put. */
export function resizeRect(r: Rect, handle: HandleId, p: Pt): Rect {
  const fixed: Pt = {
    x: handle === 'nw' || handle === 'sw' ? r.x + r.w : r.x,
    y: handle === 'nw' || handle === 'ne' ? r.y + r.h : r.y,
  };
  return normRect(fixed, p);
}

export function resizeAnnotation(a: Annotation, handle: HandleId, p: Pt): Annotation {
  if (a.type === 'arrow') return handle === 'p1' ? { ...a, x1: p.x, y1: p.y } : handle === 'p2' ? { ...a, x2: p.x, y2: p.y } : a;
  if (isBox(a)) return { ...a, ...resizeRect(a, handle, p) };
  return a;
}

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.type === 'arrow') return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.type === 'pen') return { ...a, points: a.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  return { ...a, x: a.x + dx, y: a.y + dy };
}

/** Drags that ended up too small to mean anything (a click with a box tool). */
export function isDegenerate(a: Annotation): boolean {
  if (a.type === 'arrow') return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 4;
  if (a.type === 'pen') return a.points.length < 2;
  if (a.type === 'text') return a.text.trim() === '';
  return a.w < 3 || a.h < 3;
}

/** Appends a pen point unless it is within `minDist` of the previous one. */
export function addPenPoint(points: number[], p: Pt, minDist: number): number[] {
  const n = points.length;
  if (n >= 2 && Math.hypot(p.x - points[n - 2], p.y - points[n - 1]) < minDist) return points;
  return [...points, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
}

export function replaceAnnotation(anns: readonly Annotation[], next: Annotation): Annotation[] {
  return anns.map((a) => (a.id === next.id ? next : a));
}

// ---------- Validation of stored scenes (data from IndexedDB is untrusted) ----------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const rectOk = (o: Record<string, unknown>) => finite(o.x) && finite(o.y) && finite(o.w) && finite(o.h) && (o.w as number) >= 0 && (o.h as number) >= 0;

function parseAnnotation(v: unknown): Annotation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const r = () => ({ x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number });
  switch (o.type) {
    case 'highlight':
      return rectOk(o) && color(o.color) ? { id: o.id, type: 'highlight', ...r(), color: o.color } : null;
    case 'spotlight':
      return rectOk(o) ? { id: o.id, type: 'spotlight', ...r() } : null;
    case 'rect':
      return rectOk(o) && color(o.color) && finite(o.width) ? { id: o.id, type: 'rect', ...r(), color: o.color, width: o.width } : null;
    case 'blur':
      return rectOk(o) ? { id: o.id, type: 'blur', ...r(), style: o.style === 'solid' ? 'solid' : 'pixelate' } : null;
    case 'arrow':
      return finite(o.x1) && finite(o.y1) && finite(o.x2) && finite(o.y2) && color(o.color) && finite(o.width)
        ? { id: o.id, type: 'arrow', x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, color: o.color, width: o.width }
        : null;
    case 'pen':
      return Array.isArray(o.points) && o.points.length >= 2 && o.points.length % 2 === 0 && o.points.every(finite) && color(o.color) && finite(o.width)
        ? { id: o.id, type: 'pen', points: o.points as number[], color: o.color, width: o.width }
        : null;
    case 'text':
      return rectOk(o) && typeof o.text === 'string' && color(o.color) && finite(o.size) && o.size > 0
        ? { id: o.id, type: 'text', ...r(), text: o.text.slice(0, 5000), color: o.color, size: o.size }
        : null;
    default:
      return null;
  }
}

/** Validates a stored scene. Bad annotations are dropped, never the whole scene. */
export function parseScene(raw: unknown): Scene {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const annotations = Array.isArray(o.annotations) ? o.annotations.map(parseAnnotation).filter((a): a is Annotation => a !== null) : [];
  const c = o.crop && typeof o.crop === 'object' ? (o.crop as Record<string, unknown>) : null;
  const crop = c && rectOk(c) && (c.w as number) >= 1 && (c.h as number) >= 1 ? { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number } : null;
  return { annotations, crop };
}

// ---------- Undo / redo ----------

/** Snapshot history: `present` plus bounded past / future stacks. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
