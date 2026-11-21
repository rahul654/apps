/** Draw a computed TextLayout to a canvas (rasteriser) or a pdf-lib page (vector). */
import { degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { displayToPdf, type PageGeometry } from '../coords';
import { mergeFragments, type TextLayout } from './layout';
import { canvasFont, type Canvas2D } from './measure';
import type { RunMarks } from './model';

export interface BoxPaint {
  background: string | null;
  /** 0–1 */
  opacity: number;
}

function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const color = (hex: string) => {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
};

/** Paint at `scale` canvas pixels per point. Background is transparent unless set. */
export function drawLayoutToCanvas(ctx: Canvas2D, layout: TextLayout, paint: BoxPaint, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  if (paint.background) {
    ctx.fillStyle = paint.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }
  for (const d of layout.decorations.filter((x) => x.kind === 'highlight')) {
    ctx.fillStyle = d.color;
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const f of layout.fragments) {
    if (f.space) continue;
    ctx.font = canvasFont(f.marks);
    ctx.fillStyle = f.marks.color;
    ctx.direction = f.rtl ? 'rtl' : 'ltr';
    ctx.fillText(f.text, f.x, f.baseline);
  }
  ctx.direction = 'ltr';
  for (const d of layout.decorations.filter((x) => x.kind !== 'highlight')) {
    ctx.fillStyle = d.color;
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }
  ctx.restore();
}

/**
 * Write a layout as real text. (boxX, boxY) is the box's top-left in display space;
 * everything is rotated by the page's /Rotate so it reads upright on rotated pages.
 */
export function drawLayoutToPdf(page: PDFPage, g: PageGeometry, boxX: number, boxY: number, layout: TextLayout, paint: BoxPaint, fontFor: (m: RunMarks) => PDFFont): void {
  const rot = degrees(g.rotation);
  const opacity = paint.opacity < 1 ? paint.opacity : undefined;
  const rect = (x: number, y: number, w: number, h: number, hex: string) => {
    const p = displayToPdf(g, boxX + x, boxY + y + h);
    page.drawRectangle({ x: p.x, y: p.y, width: w, height: h, color: color(hex), opacity, borderWidth: 0, rotate: rot });
  };
  if (paint.background) rect(0, 0, layout.width, layout.height, paint.background);
  for (const d of layout.decorations) if (d.kind === 'highlight') rect(d.x, d.y, d.w, d.h, d.color);
  for (const f of mergeFragments(layout.fragments)) {
    const p = displayToPdf(g, boxX + f.x, boxY + f.baseline);
    page.drawText(f.text.normalize('NFC'), { x: p.x, y: p.y, size: f.marks.size, font: fontFor(f.marks), color: color(f.marks.color), rotate: rot, opacity });
  }
  for (const d of layout.decorations) if (d.kind !== 'highlight') rect(d.x, d.y, d.w, d.h, d.color);
}
