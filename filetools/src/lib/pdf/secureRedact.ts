/** Secure redaction: rasterise pages (with the black boxes already drawn) via pdf.js (browser only). */
import type { EmbeddableImage } from './ops';
import { canvasToBlob, openPdf, renderPage } from './pdfjs';

export const REDACT_DPI = 200;

export async function rasterizePages(bytes: Uint8Array, pages: number[], dpi = REDACT_DPI, onProgress?: (f: number) => void): Promise<Map<number, EmbeddableImage>> {
  const doc = await openPdf(bytes);
  const out = new Map<number, EmbeddableImage>();
  try {
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i / pages.length);
      const page = await doc.getPage(pages[i] + 1);
      const { canvas } = await renderPage(page, { scale: dpi / 72, annotations: true });
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      out.set(pages[i], { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'jpg', width: canvas.width, height: canvas.height });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
