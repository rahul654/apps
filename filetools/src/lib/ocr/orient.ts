/**
 * Page orientation for OCR. Tesseract will often still read text that runs vertically
 * (a page displayed sideways), but then its word boxes are tall and thin and carry no
 * direction. We detect that, find the quarter turn at which the text reads left to
 * right, and OCR at that rotation — the rotation is then composed into the pixel→PDF
 * mapping (see textLayer.renderPixelMapper). Pure; the recogniser is injected.
 */
import type { OcrPage } from './result';
import type { QuarterTurn } from './textLayer';

export const ROTATIONS: QuarterTurn[] = [0, 90, 180, 270];

/** Share of multi-character words whose box is wider than tall. */
export function wideFraction(page: OcrPage): number {
  const words = page.lines.flatMap((l) => l.words).filter((w) => [...w.text].length >= 3);
  if (!words.length) return 0;
  return words.filter((w) => w.bbox.x1 - w.bbox.x0 > w.bbox.y1 - w.bbox.y0).length / words.length;
}

export function charCount(page: OcrPage): number {
  return page.lines.reduce((n, l) => n + l.words.reduce((m, w) => m + [...w.text].length, 0), 0);
}

/** Does this result suggest the text isn't upright (or we found nothing)? */
export function needsOrientationCheck(page: OcrPage): boolean {
  const chars = charCount(page);
  if (chars < 4) return true;
  if (page.confidence < 60) return true;
  return wideFraction(page) < 0.5;
}

/** Score a trial: confident, plenty of text, and words laid out horizontally. */
export function orientationScore(page: OcrPage): number {
  return page.confidence * Math.log(1 + charCount(page)) * (0.1 + wideFraction(page));
}

export type RecognizeAt = (rotation: QuarterTurn, quick: boolean) => Promise<OcrPage>;

/**
 * OCR upright first; only if the result looks rotated, try all four quarter turns on a
 * quick (downscaled) pass and redo the best one at full size. Returns the result and the
 * clockwise rotation that was applied to the image before OCR.
 */
export async function recognizeOriented(recognize: RecognizeAt, opts: { auto: boolean; rotation?: QuarterTurn } = { auto: true }): Promise<{ result: OcrPage; rotation: QuarterTurn }> {
  const base = opts.rotation ?? 0;
  const first = await recognize(base, false);
  if (!opts.auto || !needsOrientationCheck(first)) return { result: first, rotation: base };
  const trials = await Promise.all(ROTATIONS.map(async (r) => ({ r, page: await recognize(r, true) })));
  let best = trials[0];
  for (const t of trials) if (orientationScore(t.page) > orientationScore(best.page)) best = t;
  if (best.r === base) return { result: first, rotation: base };
  const full = await recognize(best.r, false);
  return orientationScore(full) >= orientationScore(first) ? { result: full, rotation: best.r } : { result: first, rotation: base };
}
