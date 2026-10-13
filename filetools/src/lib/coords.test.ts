import { describe, expect, it } from 'vitest';
import { anchorForBox, applyFrame, displayFrame, displaySize, displayToPdf, normalizeRotation, pdfToDisplay, screenToDisplay, type PageGeometry, type PageRotation } from './coords';

const ROTATIONS: PageRotation[] = [0, 90, 180, 270];
// A page whose box doesn't start at the origin, to catch x0/y0 mistakes.
const geom = (rotation: PageRotation): PageGeometry => ({ x0: 10, y0: 20, width: 200, height: 100, rotation });

describe('normalizeRotation', () => {
  it('normalises any multiple of 90', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(720)).toBe(0);
  });
});

describe('PDF ⇄ display mapping', () => {
  it('swaps display size for 90/270', () => {
    expect(displaySize(geom(0))).toEqual({ width: 200, height: 100 });
    expect(displaySize(geom(90))).toEqual({ width: 100, height: 200 });
    expect(displaySize(geom(270))).toEqual({ width: 100, height: 200 });
  });

  it('rotation 0: top-left of the page box is display (0,0); y flips', () => {
    const g = geom(0);
    expect(pdfToDisplay(g, 10, 120)).toEqual({ x: 0, y: 0 });
    expect(pdfToDisplay(g, 210, 20)).toEqual({ x: 200, y: 100 });
    expect(displayToPdf(g, 50, 30)).toEqual({ x: 60, y: 90 });
  });

  it('rotation 90 (clockwise): PDF bottom-left shows at top-left', () => {
    const g = geom(90);
    expect(pdfToDisplay(g, 10, 20)).toEqual({ x: 0, y: 0 });
    expect(pdfToDisplay(g, 10, 120)).toEqual({ x: 100, y: 0 }); // PDF top-left → display top-right
    expect(pdfToDisplay(g, 210, 20)).toEqual({ x: 0, y: 200 }); // PDF bottom-right → display bottom-left
  });

  it('rotation 180: PDF bottom-right shows at top-left', () => {
    const g = geom(180);
    expect(pdfToDisplay(g, 210, 20)).toEqual({ x: 0, y: 0 });
    expect(pdfToDisplay(g, 10, 120)).toEqual({ x: 200, y: 100 });
  });

  it('rotation 270: PDF top-right shows at top-left', () => {
    const g = geom(270);
    expect(pdfToDisplay(g, 210, 120)).toEqual({ x: 0, y: 0 });
    expect(pdfToDisplay(g, 210, 20)).toEqual({ x: 100, y: 0 });
    expect(pdfToDisplay(g, 10, 120)).toEqual({ x: 0, y: 200 });
  });

  it('round-trips for every rotation', () => {
    for (const r of ROTATIONS) {
      const g = geom(r);
      for (const [x, y] of [[10, 20], [33.5, 77.25], [210, 120], [150, 40]]) {
        const d = pdfToDisplay(g, x, y);
        const back = displayToPdf(g, d.x, d.y);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('displayFrame (used for drawSvgPath) agrees with displayToPdf', () => {
    for (const r of ROTATIONS) {
      const g = geom(r);
      const f = displayFrame(g);
      for (const [a, b] of [[0, 0], [12, 34], [90, 5], [1, 199]]) {
        const p = applyFrame(f, a, b);
        const q = displayToPdf(g, a, b);
        expect(p.x).toBeCloseTo(q.x, 9);
        expect(p.y).toBeCloseTo(q.y, 9);
      }
    }
  });

  it('anchorForBox: rotating the box about the anchor by the page rotation covers the display box', () => {
    for (const r of ROTATIONS) {
      const g = geom(r);
      const box = { left: 15, top: 25, w: 40, h: 10 };
      const a = anchorForBox(g, box.left, box.top, box.h);
      expect(a.rotate).toBe(r);
      // pdf-lib draws the box's local (w, h) corner at anchor + R(rotate)·(w, h).
      const t = (r * Math.PI) / 180;
      const cx = a.x + box.w * Math.cos(t) - box.h * Math.sin(t);
      const cy = a.y + box.w * Math.sin(t) + box.h * Math.cos(t);
      const expected = displayToPdf(g, box.left + box.w, box.top); // display top-right
      expect(cx).toBeCloseTo(expected.x, 9);
      expect(cy).toBeCloseTo(expected.y, 9);
    }
  });

  it('screenToDisplay divides by zoom', () => {
    expect(screenToDisplay(150, 75, 1.5)).toEqual({ x: 100, y: 50 });
  });
});
