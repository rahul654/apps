import { resizeObject, type ImageObj, type LineObj, type ShapeObj, type TextObj as TObj } from './pdf/editorModel';
import { describe, expect, it } from 'vitest';
import { arrowHead, hexToRgb01, objectBounds, smoothPath, translateObject, type PathObj } from './pdf/editorModel';
import { DEFAULT_MARKS, makeParagraph } from './text/model';
import { readJpegOrientation, sniffType } from './sniff';
import { isWinAnsiChar, replaceUnsupported, unsupportedChars } from './winAnsi';

describe('WinAnsi check', () => {
  it('accepts Latin text incl. cp1252 extras', () => {
    expect(unsupportedChars('Hello, Café — “quotes” €5 ™ Œuvre')).toEqual([]);
    expect(isWinAnsiChar('\n')).toBe(true);
  });
  it('lists unsupported characters once each', () => {
    expect(unsupportedChars('नमस्ते abc न')).toEqual(['न', 'म', 'स', '्', 'त', 'े']);
    expect(unsupportedChars('😀 ok')).toEqual(['😀']);
    expect(unsupportedChars('Ā')).toEqual(['Ā']);
  });
  it('replaces unsupported characters', () => {
    expect(replaceUnsupported('a😀b')).toBe('a?b');
  });
});

/** Minimal JPEG with an EXIF APP1 segment carrying the given orientation. */
function jpegWithOrientation(orientation: number, little: boolean): Uint8Array {
  const tiff: number[] = little ? [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0] : [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8];
  const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const ifd = [...u16(1), ...u16(0x0112), ...u16(3), ...(little ? [1, 0, 0, 0] : [0, 0, 0, 1]), ...u16(orientation), 0, 0, 0, 0, 0, 0];
  const body = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], tiff, ifd);
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...body, 0xff, 0xd9]);
}

describe('sniffing', () => {
  it('detects common formats from magic bytes', () => {
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('png');
    expect(sniffType(new TextEncoder().encode('GIF89a'))).toBe('gif');
    expect(sniffType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffType(new TextEncoder().encode('\0\0\0\x18ftypheic\0\0'))).toBe('heic');
    expect(sniffType(new TextEncoder().encode('\0\0\0\x1cftypavif\0\0'))).toBe('avif');
    expect(sniffType(new TextEncoder().encode('%PDF-1.7\n'))).toBe('pdf');
    expect(sniffType(new Uint8Array([1, 2, 3]))).toBe('unknown');
  });
  it('reads JPEG EXIF orientation (both byte orders)', () => {
    expect(readJpegOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(readJpegOrientation(jpegWithOrientation(3, false))).toBe(3);
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(readJpegOrientation(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('editor model helpers', () => {
  it('parses colours', () => {
    expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb01('#0f0')).toEqual([0, 1, 0]);
    expect(hexToRgb01('nope')).toEqual([0, 0, 0]);
  });
  it('builds smooth paths', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([1, 2, 3, 4])).toBe('M 1 2 L 3 4');
    expect(smoothPath([0, 0, 10, 0, 10, 10, 20, 10])).toBe('M 0 0 Q 10 0 10 5 Q 10 10 15 10 L 20 10');
  });
  it('computes arrow heads behind the tip', () => {
    const [ax, ay, bx, by] = arrowHead(0, 0, 100, 0, 2);
    expect(ax).toBeLessThan(100);
    expect(bx).toBeLessThan(100);
    expect(ay).toBeCloseTo(-by);
  });
  it('translates and bounds paths', () => {
    const p: PathObj = { id: 'a', page: 0, type: 'path', points: [0, 0, 10, 20], color: '#000', width: 2, opacity: 1, highlighter: false };
    const moved = translateObject(p, 5, -5);
    expect(moved.points).toEqual([5, -5, 15, 15]);
    expect(objectBounds(moved)).toEqual({ x: 4, y: -6, w: 12, h: 22 });
  });
});


describe('resizeObject', () => {
  const rect: ShapeObj = { id: 'r', page: 0, type: 'rect', x: 10, y: 10, w: 100, h: 50, stroke: '#000', fill: null, strokeWidth: 1, opacity: 1 };
  it('keeps the opposite corner fixed', () => {
    expect(resizeObject(rect, 'se', 20, 10)).toMatchObject({ x: 10, y: 10, w: 120, h: 60 });
    expect(resizeObject(rect, 'nw', 20, 10)).toMatchObject({ x: 30, y: 20, w: 80, h: 40 });
    expect(resizeObject(rect, 'ne', 5, -5)).toMatchObject({ x: 10, y: 5, w: 105, h: 55 });
  });
  it('enforces a minimum size', () => {
    expect(resizeObject(rect, 'se', -500, -500)).toMatchObject({ w: 4, h: 4 });
  });
  it('keeps image aspect ratio', () => {
    const img: ImageObj = { id: 'i', page: 0, type: 'image', x: 0, y: 0, w: 200, h: 100, imageId: 'a', signature: false };
    const r = resizeObject(img, 'se', 100, 0);
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.w).toBe(300);
  });
  it('resizes text boxes: side handles change width, corner scales text', () => {
    const t: TObj = { id: 't', page: 0, type: 'text', x: 10, y: 0, w: 100, paragraphs: [makeParagraph('Hi', { ...DEFAULT_MARKS, size: 10 })], background: null, padding: 2, opacity: 1 };
    expect(resizeObject(t, 'e', 50, 0)).toMatchObject({ x: 10, w: 150 });
    expect(resizeObject(t, 'w', 30, 0)).toMatchObject({ x: 40, w: 70 });
    expect(resizeObject(t, 'w', 500, 0).w).toBe(16); // minimum width
    const scaled = resizeObject(t, 'se', 100, 0);
    expect(scaled.w).toBe(200);
    expect(scaled.paragraphs[0].runs[0].marks.size).toBe(20);
  });
  it('moves line ends', () => {
    const l: LineObj = { id: 'l', page: 0, type: 'line', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 1, arrow: false, opacity: 1 };
    expect(resizeObject(l, 'p2', 5, 5)).toMatchObject({ x2: 15, y2: 15, x1: 0 });
  });
});
