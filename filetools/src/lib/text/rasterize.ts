/**
 * Rasterise a text box with a 2D canvas (the browser's shaping, bidi within words and
 * system fallback fonts). The canvas is injected so the same code runs with
 * @napi-rs/canvas in Node tests.
 */
import { layoutText } from './layout';
import { canvasMeasure, type Canvas2D } from './measure';
import type { RasterRequest, RasterResult } from './boxWriter';
import { drawLayoutToCanvas } from './render';

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

export interface CanvasEnv {
  create(width: number, height: number): CanvasLike;
  toPng(canvas: CanvasLike): Promise<Uint8Array>;
}

/** Largest bitmap side we'll allocate for one text box. */
const MAX_SIDE = 8000;

export async function rasterizeTextBox(req: RasterRequest, env: CanvasEnv): Promise<RasterResult> {
  const probe = env.create(1, 1);
  const layout = layoutText(req.paragraphs, { width: req.width, padding: req.padding }, canvasMeasure(probe.getContext('2d') as Canvas2D));
  let scale = req.dpi / 72;
  scale = Math.min(scale, MAX_SIDE / Math.max(layout.width, layout.height, 1));
  const canvas = env.create(Math.max(1, Math.ceil(layout.width * scale)), Math.max(1, Math.ceil(layout.height * scale)));
  drawLayoutToCanvas(canvas.getContext('2d') as Canvas2D, layout, { background: req.background, opacity: 1 }, scale);
  const bytes = await env.toPng(canvas);
  return { image: { bytes, format: 'png', width: canvas.width, height: canvas.height }, height: layout.height };
}

/** Browser canvas environment. */
export const domCanvasEnv: CanvasEnv = {
  create(width, height) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  },
  async toPng(canvas) {
    const c = canvas as HTMLCanvasElement;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    if (!blob) throw new Error('Couldn’t render a text box (out of memory?).');
    return new Uint8Array(await blob.arrayBuffer());
  },
};
