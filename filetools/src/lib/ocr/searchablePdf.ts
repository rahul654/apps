/** Searchable PDF from images: each image becomes a page with an invisible OCR text layer. Pure (pdf-lib). */
import { PDFDocument } from 'pdf-lib';
import type { EmbeddableImage } from '../pdf/ops';
import type { OcrPage } from './result';
import { addInvisibleTextLayer, quadsFromOcrLines, renderPixelMapper } from './textLayer';

export interface SearchableImagePage {
  image: EmbeddableImage;
  /** OCR result; its boxes refer to an image of ocr.width × ocr.height pixels showing the same content. */
  ocr: OcrPage;
}

/** Points per image pixel: 96 dpi, but never larger than an A4 page on the long side. */
export function pointsPerPixel(widthPx: number, heightPx: number): number {
  return Math.min(0.75, 841.89 / Math.max(widthPx, heightPx, 1));
}

export async function imagesToSearchablePdf(pages: SearchableImagePage[], title?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  for (const p of pages) {
    const k = pointsPerPixel(p.image.width, p.image.height);
    const w = p.image.width * k;
    const h = p.image.height * k;
    const page = doc.addPage([w, h]);
    const img = p.image.format === 'png' ? await doc.embedPng(p.image.bytes) : await doc.embedJpg(p.image.bytes);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    // OCR pixels → page points (the OCR'd image shows the page upright, maybe upscaled).
    const map = renderPixelMapper({ x0: 0, y0: 0, width: w, height: h, rotation: 0 }, p.ocr.width / w, p.ocr.width, p.ocr.height, 0);
    addInvisibleTextLayer(doc, page, quadsFromOcrLines(p.ocr.lines, map));
  }
  return doc.save({ useObjectStreams: true });
}
