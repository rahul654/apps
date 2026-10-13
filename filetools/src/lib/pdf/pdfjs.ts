/**
 * pdf.js setup (browser only). Imported only by lazily-loaded PDF tools, so the
 * ~1.8 MB of pdf.js never loads on the home page.
 *
 * We use the "legacy" build: same API, but transpiled + polyfilled for older
 * browsers (e.g. Safari < 17.4 lacks Promise.withResolvers, which pdf.js 4 uses).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { clampToPixels } from '../resize';
import type { PageGeometry } from '../coords';
import { normalizeRotation } from '../coords';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export class PasswordRequiredError extends Error {
  readonly incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? 'Incorrect password — try again.' : 'This PDF is password-protected. Enter the password to open it.');
    this.incorrect = incorrect;
    this.name = 'PasswordRequiredError';
  }
}

/** CMaps / standard font data are copied to ./pdfjs/ by vite.config.ts (relative to index.html). */
function assetUrl(dir: string): string {
  return new URL(`./pdfjs/${dir}/`, document.baseURI).href;
}

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    // pdf.js transfers (detaches) the buffer it's given, so always pass a copy.
    data: bytes.slice(),
    password,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    isEvalSupported: false,
    enableXfa: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number; message?: string };
    if (err?.name === 'PasswordException') throw new PasswordRequiredError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (err?.name === 'InvalidPDFException') throw new Error('This file isn’t a valid PDF (or it’s damaged).');
    throw new Error(`Couldn’t open the PDF: ${err?.message ?? e}`);
  }
}

export function geometryOf(page: PDFPageProxy): PageGeometry {
  const [x0, y0, x1, y1] = page.view;
  return { x0, y0, width: x1 - x0, height: y1 - y0, rotation: normalizeRotation(page.rotate) };
}

export interface RenderOptions {
  /** CSS-pixel scale: 1 = 72 dpi. */
  scale: number;
  /** Extra multiplier for crisp output on HiDPI screens (canvas pixels only). */
  pixelRatio?: number;
  /** Paint annotations incl. form field appearances (default: yes). */
  annotations?: boolean;
  background?: string;
}

/**
 * Render a page into a canvas (created if not given). Returns the canvas and the
 * effective scale (may be lower than requested for huge pages, to stay within the
 * browser's canvas size limit).
 */
export async function renderPage(page: PDFPageProxy, opts: RenderOptions, canvas = document.createElement('canvas')) {
  const ratio = opts.pixelRatio ?? 1;
  const vp1 = page.getViewport({ scale: opts.scale * ratio });
  const clamp = clampToPixels(Math.ceil(vp1.width), Math.ceil(vp1.height));
  const viewport = clamp.factor < 1 ? page.getViewport({ scale: opts.scale * ratio * clamp.factor }) : vp1;
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas isn’t available in this browser.');
  ctx.fillStyle = opts.background ?? '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({
    canvasContext: ctx,
    viewport,
    annotationMode: opts.annotations === false ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE,
  });
  await task.promise;
  return { canvas, task, effectiveScale: viewport.scale / ratio, reduced: clamp.factor < 1 };
}

export type AnnotationRender = 'all' | 'no-forms' | 'none';

/**
 * Render with cancellation support (for scrolling/zooming viewers).
 * 'no-forms' paints annotations except form fields (the editor overlays its own inputs).
 */
export function startRender(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, pixelRatio: number, annotations: AnnotationRender = 'all') {
  const vp1 = page.getViewport({ scale: scale * pixelRatio });
  const clamp = clampToPixels(Math.ceil(vp1.width), Math.ceil(vp1.height), 12_000_000);
  const viewport = clamp.factor < 1 ? page.getViewport({ scale: scale * pixelRatio * clamp.factor }) : vp1;
  const off = document.createElement('canvas');
  off.width = Math.ceil(viewport.width);
  off.height = Math.ceil(viewport.height);
  const ctx = off.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, off.width, off.height);
  const task = page.render({
    canvasContext: ctx,
    viewport,
    annotationMode: annotations === 'all' ? pdfjs.AnnotationMode.ENABLE : annotations === 'no-forms' ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.DISABLE,
  });
  const promise = task.promise.then(() => {
    // Swap in the finished bitmap at once to avoid flashing a blank canvas.
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d')!.drawImage(off, 0, 0);
    off.width = off.height = 0;
  });
  return {
    promise,
    cancel: () => {
      task.cancel();
      off.width = off.height = 0;
    },
  };
}

export function isCancelled(e: unknown): boolean {
  return (e as { name?: string })?.name === 'RenderingCancelledException';
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the image (out of memory?).'))), type, quality);
  });
}
