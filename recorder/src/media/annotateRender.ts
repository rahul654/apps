/**
 * Draws a screenshot with its annotations. The editor and the export both call `drawScene`,
 * so what you see is exactly what you download.
 *
 * Layers, bottom to top: the image → blur / solid boxes (they sample only the image, so the
 * hidden pixels are gone from the export) → spotlight dimming → marks in the order they were made.
 */
import {
  clampRect,
  handlesFor,
  pixelBlock,
  viewRect,
  type Annotation,
  type ArrowAnn,
  type BlurAnn,
  type PenAnn,
  type Rect,
  type Scene,
  type TextAnn,
} from '../lib/annotations';

type Ctx = CanvasRenderingContext2D;

export const TEXT_FONT = 'Arial, Helvetica, sans-serif';
const LINE_HEIGHT = 1.25;
const SPOTLIGHT_DIM = 'rgba(8, 10, 20, 0.6)';
const SOLID_FILL = '#111111';

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  } else scratch.getContext('2d')!.clearRect(0, 0, w, h);
  return scratch;
}

function roundRectPath(ctx: Ctx, r: Rect, radius: number) {
  ctx.beginPath();
  const rr = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  if (typeof ctx.roundRect === 'function') ctx.roundRect(r.x, r.y, r.w, r.h, rr);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

function drawBlur(ctx: Ctx, img: CanvasImageSource, blur: BlurAnn, imageW: number, imageH: number) {
  const a = clampRect(blur, imageW, imageH);
  if (!a) return;
  if (blur.style === 'solid') {
    ctx.fillStyle = SOLID_FILL;
    ctx.fillRect(a.x, a.y, a.w, a.h);
    return;
  }
  const block = pixelBlock(a);
  const sw = Math.max(1, Math.ceil(a.w / block));
  const sh = Math.max(1, Math.ceil(a.h / block));
  const tmp = scratchCanvas(sw, sh);
  const t = tmp.getContext('2d')!;
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = 'high';
  t.drawImage(img, a.x, a.y, a.w, a.h, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, a.x, a.y, sw * block, sh * block);
  ctx.restore();
}

function drawSpotlights(ctx: Ctx, spots: Rect[], view: Rect) {
  if (spots.length === 0) return;
  const layer = scratchCanvas(view.w, view.h);
  const l = layer.getContext('2d')!;
  l.fillStyle = SPOTLIGHT_DIM;
  l.fillRect(0, 0, view.w, view.h);
  l.globalCompositeOperation = 'destination-out';
  l.fillStyle = '#000';
  for (const s of spots) {
    roundRectPath(l, { x: s.x - view.x, y: s.y - view.y, w: s.w, h: s.h }, Math.min(12, s.w / 6, s.h / 6));
    l.fill();
  }
  l.globalCompositeOperation = 'source-over';
  ctx.drawImage(layer, view.x, view.y);
}

function drawArrow(ctx: Ctx, a: ArrowAnn) {
  const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  if (len < 1) return;
  const head = Math.min(len * 0.6, Math.max(14, a.width * 4));
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const spread = Math.PI / 7;
  // Shaft stops inside the head so the round cap doesn't poke out of the tip.
  const bx = a.x2 - Math.cos(ang) * head * 0.8;
  const by = a.y2 - Math.sin(ang) * head * 0.8;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x1, a.y1);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.x2, a.y2);
  ctx.lineTo(a.x2 - Math.cos(ang - spread) * head, a.y2 - Math.sin(ang - spread) * head);
  ctx.lineTo(a.x2 - Math.cos(ang + spread) * head, a.y2 - Math.sin(ang + spread) * head);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, a.width / 2);
  ctx.stroke();
}

function drawPen(ctx: Ctx, a: PenAnn) {
  const p = a.points;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], a.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  // Quadratic curves through the midpoints: smooth without overshooting.
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

/** Dark text gets a light outline and vice versa, so it reads on any background. */
function outlineFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.92)';
}

export function textFont(size: number): string {
  return `bold ${size}px ${TEXT_FONT}`;
}

/** Size of a text box (image px) as drawn by `drawText`. */
export function measureText(ctx: Ctx, text: string, size: number): { w: number; h: number } {
  ctx.save();
  ctx.font = textFont(size);
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), size * 0.3);
  ctx.restore();
  const pad = textPad(size);
  return { w: Math.ceil(w + pad * 2), h: Math.ceil(lines.length * size * LINE_HEIGHT + pad * 2) };
}

export const textPad = (size: number) => Math.round(size * 0.18);

function drawText(ctx: Ctx, a: TextAnn) {
  const pad = textPad(a.size);
  ctx.font = textFont(a.size);
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, a.size / 6);
  ctx.strokeStyle = outlineFor(a.color);
  ctx.fillStyle = a.color;
  const lines = a.text.split('\n');
  lines.forEach((line, i) => {
    const y = a.y + pad + i * a.size * LINE_HEIGHT + a.size * (LINE_HEIGHT - 1) / 2;
    ctx.strokeText(line, a.x + pad, y);
    ctx.fillText(line, a.x + pad, y);
  });
}

function drawMark(ctx: Ctx, a: Annotation) {
  ctx.save();
  switch (a.type) {
    case 'highlight':
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = a.color;
      roundRectPath(ctx, a, Math.min(4, a.h / 4));
      ctx.fill();
      break;
    case 'rect':
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineJoin = 'round';
      roundRectPath(ctx, a, a.width * 1.5);
      ctx.stroke();
      break;
    case 'arrow':
      drawArrow(ctx, a);
      break;
    case 'pen':
      drawPen(ctx, a);
      break;
    case 'text':
      drawText(ctx, a);
      break;
    default:
      break;
  }
  ctx.restore();
}

export interface DrawOptions {
  /** Region of the image drawn into the canvas (the canvas is view.w × view.h). Default: the scene's crop. */
  view?: Rect;
  /** Annotation hidden while it is being edited (e.g. text in the textarea). */
  hideId?: string;
}

/** Draws image + annotations into a canvas sized to the view. */
export function drawScene(ctx: Ctx, img: CanvasImageSource, imageW: number, imageH: number, scene: Scene, opts: DrawOptions = {}) {
  const view = opts.view ?? viewRect(scene, imageW, imageH);
  const anns = opts.hideId ? scene.annotations.filter((a) => a.id !== opts.hideId) : scene.annotations;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, -view.x, -view.y);
  ctx.clearRect(view.x, view.y, view.w, view.h);
  ctx.drawImage(img, 0, 0, imageW, imageH);
  for (const a of anns) {
    if (a.type !== 'blur') continue;
    // The last row / column of blocks can overshoot the box: clip it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    drawBlur(ctx, img, a, imageW, imageH);
    ctx.restore();
  }
  drawSpotlights(ctx, anns.filter((a) => a.type === 'spotlight'), view);
  for (const a of anns) if (a.type !== 'blur' && a.type !== 'spotlight') drawMark(ctx, a);
  ctx.restore();
}

// ---------- Editor overlay (never exported) ----------

export interface OverlayOptions {
  view: Rect;
  /** Image px per screen px, so handles keep their on-screen size. */
  pxPerScreen: number;
  selected?: Annotation | null;
  /** Crop being edited: everything outside is dimmed. */
  crop?: Rect | null;
  /** Rectangle being dragged out with a box tool before it becomes an annotation. */
  marquee?: Rect | null;
}

function drawHandles(ctx: Ctx, pts: Array<{ x: number; y: number }>, s: number) {
  const size = 9 * s;
  ctx.lineWidth = 1.5 * s;
  for (const p of pts) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#7c3aed';
    ctx.beginPath();
    ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
  }
}

export function drawOverlay(ctx: Ctx, opts: OverlayOptions, boundsOf: (a: Annotation) => Rect) {
  const { view, pxPerScreen: s } = opts;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, -view.x, -view.y);
  if (opts.crop) {
    const c = opts.crop;
    ctx.fillStyle = 'rgba(8, 10, 20, 0.55)';
    ctx.beginPath();
    ctx.rect(view.x, view.y, view.w, view.h);
    ctx.rect(c.x, c.y + c.h, c.w, -c.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.setLineDash([]);
    // Rule-of-thirds guides.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = s;
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(c.x + c.w * f, c.y);
      ctx.lineTo(c.x + c.w * f, c.y + c.h);
      ctx.moveTo(c.x, c.y + c.h * f);
      ctx.lineTo(c.x + c.w, c.y + c.h * f);
    }
    ctx.stroke();
    drawHandles(ctx, handlesFor(c), s);
  }
  if (opts.marquee) {
    const m = opts.marquee;
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([5 * s, 4 * s]);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.setLineDash([]);
  }
  const a = opts.selected;
  if (a) {
    const b = boundsOf(a);
    const pad = 4 * s + (a.type === 'rect' || a.type === 'arrow' || a.type === 'pen' ? a.width / 2 : 0);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([5 * s, 4 * s]);
    if (a.type !== 'arrow') ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
    drawHandles(ctx, handlesFor(a), s);
  }
  ctx.restore();
}

// ---------- Decoding / export ----------

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Decodes an image Blob for drawing (ImageBitmap where available). */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ExportType = 'image/png' | 'image/jpeg' | 'image/webp';

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser couldn’t encode the image.'))), type, quality));
}

/** The annotated (and cropped) screenshot at full resolution. */
export async function renderScene(img: LoadedImage, scene: Scene, type: ExportType = 'image/png', quality = 0.92): Promise<Blob> {
  const view = viewRect(scene, img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = view.w;
  canvas.height = view.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas isn’t available in this browser.');
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, view.w, view.h);
  }
  drawScene(ctx, img.source, img.width, img.height, scene, { view });
  const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : quality);
  canvas.width = canvas.height = 0;
  return blob;
}

/** Small JPEG for the library card. */
export async function renderThumbnail(img: LoadedImage, scene: Scene, width = 480): Promise<Blob> {
  const view = viewRect(scene, img.width, img.height);
  const full = document.createElement('canvas');
  full.width = view.w;
  full.height = view.h;
  drawScene(full.getContext('2d')!, img.source, img.width, img.height, scene, { view });
  const w = Math.min(width, view.w);
  const h = Math.max(1, Math.round((view.h / view.w) * w));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, w, h);
  full.width = full.height = 0;
  const blob = await canvasToBlob(small, 'image/jpeg', 0.82);
  small.width = small.height = 0;
  return blob;
}
