import { describe, expect, it } from 'vitest';
import {
  addPenPoint,
  bounds,
  clampRect,
  hitHandle,
  hits,
  hitTest,
  historyOf,
  isDegenerate,
  moveAnnotation,
  normRect,
  parseScene,
  pixelBlock,
  pushHistory,
  redo,
  resizeAnnotation,
  resizeRect,
  strokeWidth,
  styleUnit,
  undo,
  viewRect,
  type Annotation,
  type ArrowAnn,
  type PenAnn,
  type RectAnn,
} from './annotations';

const rect = (over: Partial<RectAnn> = {}): RectAnn => ({ id: 'r', type: 'rect', x: 100, y: 100, w: 200, h: 100, color: '#ef4444', width: 4, ...over });
const arrow: ArrowAnn = { id: 'a', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, color: '#ef4444', width: 4 };
const pen: PenAnn = { id: 'p', type: 'pen', points: [0, 0, 10, 10, 20, 0], color: '#111827', width: 2 };

describe('geometry', () => {
  it('normRect works for any drag direction', () => {
    expect(normRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it('clampRect keeps the part inside the image and drops empty results', () => {
    expect(clampRect({ x: -10, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 0, y: 90, w: 40, h: 10 });
    expect(clampRect({ x: 120, y: 0, w: 10, h: 10 }, 100, 100)).toBeNull();
  });

  it('viewRect is the crop, or the whole image', () => {
    expect(viewRect({ annotations: [], crop: null }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(viewRect({ annotations: [], crop: { x: 700, y: 500, w: 300, h: 300 } }, 800, 600)).toEqual({ x: 700, y: 500, w: 100, h: 100 });
  });

  it('bounds of arrows and pen strokes', () => {
    expect(bounds({ ...arrow, x1: 50, y1: 40, x2: 10, y2: 90 })).toEqual({ x: 10, y: 40, w: 40, h: 50 });
    expect(bounds(pen)).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });

  it('scales stroke widths with the capture size', () => {
    expect(styleUnit(1920, 1080)).toBe(1);
    expect(styleUnit(1280, 720)).toBe(1);
    expect(styleUnit(3840, 2160)).toBe(2);
    expect(strokeWidth('m', 2)).toBe(10);
  });

  it('pixelate blocks are coarse enough to hide text', () => {
    expect(pixelBlock({ x: 0, y: 0, w: 40, h: 20 })).toBe(12);
    expect(pixelBlock({ x: 0, y: 0, w: 480, h: 30 })).toBe(30);
    expect(pixelBlock({ x: 0, y: 0, w: 4000, h: 3000 })).toBe(48);
  });
});

describe('hit-testing', () => {
  it('a box is hit on its outline, not in the middle', () => {
    const r = rect();
    expect(hits(r, { x: 101, y: 150 }, 4)).toBe(true);
    expect(hits(r, { x: 200, y: 150 }, 4)).toBe(false);
    expect(hits(r, { x: 90, y: 150 }, 4)).toBe(false);
  });

  it('highlights, blur and spotlight are hit anywhere inside', () => {
    const h: Annotation = { id: 'h', type: 'highlight', x: 0, y: 0, w: 50, h: 20, color: '#facc15' };
    expect(hits(h, { x: 25, y: 10 }, 4)).toBe(true);
    expect(hits(h, { x: 60, y: 10 }, 4)).toBe(false);
  });

  it('arrows and pen strokes are hit near the line', () => {
    expect(hits(arrow, { x: 50, y: 5 }, 4)).toBe(true);
    expect(hits(arrow, { x: 50, y: 12 }, 4)).toBe(false);
    expect(hits(pen, { x: 5, y: 6 }, 2)).toBe(true);
    expect(hits(pen, { x: 10, y: 0 }, 2)).toBe(false);
  });

  it('marks on top win, and win over spotlight / blur layers drawn under them', () => {
    const blur: Annotation = { id: 'b', type: 'blur', x: 0, y: 0, w: 200, h: 200, style: 'pixelate' };
    const h1: Annotation = { id: 'h1', type: 'highlight', x: 0, y: 0, w: 50, h: 50, color: '#facc15' };
    const h2: Annotation = { id: 'h2', type: 'highlight', x: 20, y: 20, w: 50, h: 50, color: '#facc15' };
    expect(hitTest([h1, h2, blur], { x: 30, y: 30 }, 2)?.id).toBe('h2');
    expect(hitTest([h1, h2, blur], { x: 10, y: 10 }, 2)?.id).toBe('h1');
    expect(hitTest([h1, h2, blur], { x: 150, y: 150 }, 2)?.id).toBe('b');
    expect(hitTest([h1, h2, blur], { x: 500, y: 500 }, 2)).toBeNull();
  });

  it('finds corner and endpoint handles', () => {
    expect(hitHandle(rect(), { x: 299, y: 201 }, 5)).toBe('se');
    expect(hitHandle(arrow, { x: 98, y: 2 }, 5)).toBe('p2');
    expect(hitHandle(pen, { x: 0, y: 0 }, 5)).toBeNull();
  });
});

describe('editing', () => {
  it('resizing a corner keeps the opposite corner fixed, even when dragged past it', () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(resizeRect(r, 'se', { x: 350, y: 260 })).toEqual({ x: 100, y: 100, w: 250, h: 160 });
    expect(resizeRect(r, 'nw', { x: 400, y: 50 })).toEqual({ x: 300, y: 50, w: 100, h: 150 });
  });

  it('resizes boxes and moves arrow endpoints', () => {
    expect(resizeAnnotation(rect(), 'ne', { x: 320, y: 80 })).toMatchObject({ x: 100, y: 80, w: 220, h: 120, color: '#ef4444' });
    expect(resizeAnnotation(arrow, 'p1', { x: 5, y: 7 })).toMatchObject({ x1: 5, y1: 7, x2: 100, y2: 0 });
  });

  it('moves every kind of mark', () => {
    expect(moveAnnotation(rect(), 5, -5)).toMatchObject({ x: 105, y: 95, w: 200 });
    expect(moveAnnotation(arrow, 1, 2)).toMatchObject({ x1: 1, y1: 2, x2: 101, y2: 2 });
    expect((moveAnnotation(pen, 10, 1) as PenAnn).points).toEqual([10, 1, 20, 11, 30, 1]);
  });

  it('drops clicks that made no real shape', () => {
    expect(isDegenerate(rect({ w: 2 }))).toBe(true);
    expect(isDegenerate(rect())).toBe(false);
    expect(isDegenerate({ ...arrow, x2: 2 })).toBe(true);
    expect(isDegenerate({ id: 't', type: 'text', x: 0, y: 0, w: 10, h: 10, text: '  ', color: '#111827', size: 20 })).toBe(true);
    expect(isDegenerate({ ...pen, points: [1, 1] })).toBe(false);
  });

  it('skips pen points closer than the minimum distance', () => {
    let pts = addPenPoint([], { x: 0, y: 0 }, 2);
    pts = addPenPoint(pts, { x: 1, y: 1 }, 2);
    pts = addPenPoint(pts, { x: 3, y: 0 }, 2);
    expect(pts).toEqual([0, 0, 3, 0]);
  });
});

describe('parseScene', () => {
  it('keeps valid annotations and drops broken ones', () => {
    const scene = parseScene({
      annotations: [
        rect(),
        { ...rect({ id: 'bad-color' }), color: 'red' },
        { id: 'x', type: 'laser' },
        { ...pen, points: [1, 2, 3] },
        { id: 't', type: 'text', x: 1, y: 2, w: 30, h: 20, text: 'Hi', color: '#ffffff', size: 24 },
        { id: 'b', type: 'blur', x: 0, y: 0, w: 10, h: 10, style: 'weird' },
        null,
      ],
      crop: { x: 10, y: 10, w: 0, h: 50 },
    });
    expect(scene.annotations.map((a) => a.id)).toEqual(['r', 't', 'b']);
    expect(scene.annotations[2]).toMatchObject({ style: 'pixelate' });
    expect(scene.crop).toBeNull();
  });

  it('survives garbage', () => {
    expect(parseScene(undefined)).toEqual({ annotations: [], crop: null });
    expect(parseScene({ annotations: 'nope', crop: { x: 1, y: 2, w: 3, h: 4 } })).toEqual({ annotations: [], crop: { x: 1, y: 2, w: 3, h: 4 } });
  });
});

describe('history', () => {
  it('undo / redo walk the snapshots; a new change clears redo', () => {
    let h = historyOf('a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe('b');
    h = pushHistory(h, 'd');
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
    expect(h.past).toEqual(['a', 'b']);
  });

  it('ignores no-op pushes and keeps at most `limit` undo steps', () => {
    let h = historyOf(0);
    expect(pushHistory(h, 0)).toBe(h);
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i, 3);
    expect(h.past).toEqual([7, 8, 9]);
  });
});
