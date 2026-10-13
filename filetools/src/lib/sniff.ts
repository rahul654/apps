/** File-type sniffing from magic bytes (file extensions and MIME types lie). */

export type SniffedType = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'avif' | 'heic' | 'pdf' | 'unknown';

export function sniffType(b: Uint8Array): SniffedType {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  // %PDF may be preceded by junk; search the first 1 KB.
  const head = ascii(b, 0, Math.min(b.length, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  return 'unknown';
}

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/**
 * EXIF orientation (1–8) of a JPEG, or null if absent. Only reads the APP1 header,
 * so it's cheap. 1 = upright; anything else means the pixels must be rotated/flipped.
 */
export function readJpegOrientation(b: Uint8Array): number | null {
  if (sniffType(b) !== 'jpeg') return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) return null;
    const marker = b[off + 1];
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end: no EXIF
    const size = view.getUint16(off + 2);
    if (marker === 0xe1 && ascii(b, off + 4, 6) === 'Exif\0\0') {
      const tiff = off + 10;
      if (tiff + 8 > b.length) return null;
      const little = b[tiff] === 0x49;
      const u16 = (p: number) => view.getUint16(p, little);
      const u32 = (p: number) => view.getUint32(p, little);
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > b.length) return null;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > b.length) return null;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : null;
        }
      }
      return null;
    }
    off += 2 + size;
  }
  return null;
}
