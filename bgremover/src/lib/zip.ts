import { zipSync, type Zippable } from 'fflate';

/** Stores files in a zip without recompressing them (PNG/WebP/JPEG are already compressed). */
export function makeZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const files: Zippable = {};
  for (const e of entries) files[e.name] = [e.data, { level: 0 }];
  return zipSync(files);
}
