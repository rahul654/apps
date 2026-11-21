/**
 * Draws one composited frame: the screen letterboxed into the output, with the camera bubble
 * on top. Shared by the worker compositor (OffscreenCanvas + VideoFrame) and the main-thread
 * fallback (HTMLCanvasElement + <video>).
 */
import { bubbleRect, containRect, coverCrop, type BubbleLayout } from '../lib/geometry';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
}

function roundedPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function bubblePath(ctx: Ctx2D, layout: BubbleLayout, r: { x: number; y: number; w: number; h: number; radius: number }, inset = 0) {
  if (layout.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.max(0, Math.min(r.w, r.h) / 2 - inset), 0, Math.PI * 2);
    ctx.closePath();
  } else {
    roundedPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, Math.max(0, r.radius - inset));
  }
}

export function drawComposite(ctx: Ctx2D, outW: number, outH: number, screen: Source | null, camera: Source | null, layout: BubbleLayout | null): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);
  if (screen && screen.width > 0 && screen.height > 0) {
    const d = containRect(screen.width, screen.height, outW, outH);
    ctx.drawImage(screen.image, 0, 0, screen.width, screen.height, d.x, d.y, d.w, d.h);
  }
  if (!camera || !layout || camera.width <= 0 || camera.height <= 0) return;

  const r = bubbleRect(layout, outW, outH);
  const crop = coverCrop(camera.width, camera.height, r.w, r.h);
  ctx.save();
  bubblePath(ctx, layout, r);
  ctx.clip();
  if (layout.mirror) {
    ctx.translate(r.x * 2 + r.w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(camera.image, crop.sx, crop.sy, crop.sw, crop.sh, r.x, r.y, r.w, r.h);
  ctx.restore();

  if (r.borderWidth > 0) {
    // Thin dark outline under a white ring keeps the border visible on light screens.
    ctx.save();
    ctx.lineWidth = r.borderWidth;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    bubblePath(ctx, layout, r, r.borderWidth / 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    bubblePath(ctx, layout, r, 0.5);
    ctx.stroke();
    ctx.restore();
  }
}
