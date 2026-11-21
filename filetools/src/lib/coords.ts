/**
 * Mapping between PDF user space and the on-screen "display" space of a page.
 *
 * PDF space: origin bottom-left of the page box (x0, y0), y grows UP, units = points.
 * Display space: origin top-left of the page *as shown* (after /Rotate is applied,
 * clockwise like every PDF viewer), y grows DOWN, units = points (multiply by zoom
 * for CSS pixels). Editor objects are stored in display space; they are converted
 * to PDF space only when saving.
 */

export type PageRotation = 0 | 90 | 180 | 270;

export interface PageGeometry {
  /** Page box (crop box) in PDF units: [x0, y0] lower-left corner. */
  x0: number;
  y0: number;
  /** Unrotated page box size. */
  width: number;
  height: number;
  /** The page's /Rotate (clockwise), normalised. */
  rotation: PageRotation;
}

export interface Point {
  x: number;
  y: number;
}

export function normalizeRotation(deg: number): PageRotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as PageRotation;
}

/** Size of the page as displayed (width/height swap for 90/270). */
export function displaySize(page: PageGeometry): { width: number; height: number } {
  return page.rotation === 90 || page.rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/** PDF user-space point → display point (unscaled, top-left origin). */
export function pdfToDisplay(page: PageGeometry, px: number, py: number): Point {
  const u = px - page.x0;
  const v = py - page.y0;
  const { width: W, height: H } = page;
  switch (page.rotation) {
    case 0: return { x: u, y: H - v };
    case 90: return { x: v, y: u };
    case 180: return { x: W - u, y: v };
    case 270: return { x: H - v, y: W - u };
  }
}

/** Display point (unscaled, top-left origin) → PDF user-space point. */
export function displayToPdf(page: PageGeometry, sx: number, sy: number): Point {
  const { width: W, height: H } = page;
  let u: number;
  let v: number;
  switch (page.rotation) {
    case 0: u = sx; v = H - sy; break;
    case 90: u = sy; v = sx; break;
    case 180: u = W - sx; v = sy; break;
    case 270: u = W - sy; v = H - sx; break;
  }
  return { x: page.x0 + u, y: page.y0 + v };
}

/** Screen (CSS pixel, relative to the page's top-left) → display points. */
export function screenToDisplay(sx: number, sy: number, zoom: number): Point {
  return { x: sx / zoom, y: sy / zoom };
}

/**
 * Where to anchor a pdf-lib draw call so an upright box in display space lands in
 * the right place. pdf-lib's drawRectangle/drawImage/drawText take (x, y) =
 * bottom-left (or baseline-left) corner in PDF space plus a counter-clockwise
 * `rotate`. Rotating by the page's /Rotate cancels the viewer's clockwise rotation,
 * so the object appears upright.
 */
export function anchorForBox(page: PageGeometry, left: number, top: number, height: number): { x: number; y: number; rotate: number } {
  const p = displayToPdf(page, left, top + height);
  return { x: p.x, y: p.y, rotate: page.rotation };
}

/**
 * The PDF-space frame of display space: a display point (a, b) maps to
 * origin + R(rotate°, CCW) · (a, −b). Matches pdf-lib's drawSvgPath(x, y, rotate),
 * which translates, rotates, then flips the SVG y axis.
 */
export function displayFrame(page: PageGeometry): { origin: Point; rotate: number } {
  return { origin: displayToPdf(page, 0, 0), rotate: page.rotation };
}

/** Apply the frame transform (used to cross-check displayFrame in tests). */
export function applyFrame(frame: { origin: Point; rotate: number }, a: number, b: number): Point {
  const t = (frame.rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(t) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(t) * 1e12) / 1e12;
  const x = a;
  const y = -b;
  return { x: frame.origin.x + x * cos - y * sin, y: frame.origin.y + x * sin + y * cos };
}
