import { zipSync, type Zippable } from 'fflate';
import { uniqueNames } from './format';

export interface OutputFile {
  name: string;
  blob: Blob;
}

/** Trigger a browser download for a Blob, then release the object URL. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Build a ZIP from in-memory files. Images and PDFs are already compressed, so
 * entries are stored (level 0) unless `compress` is set — much faster, same size.
 */
export function zipFiles(files: { name: string; data: Uint8Array }[], compress = false): Uint8Array {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Zippable = {};
  files.forEach((f, i) => {
    entries[names[i]] = [f.data, { level: compress ? 6 : 0 }];
  });
  return zipSync(entries);
}

export async function zipBlobs(files: OutputFile[]): Promise<Blob> {
  const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
  const zip = zipFiles(data);
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
}

export const pdfBlob = (bytes: Uint8Array) => bytesToBlob(bytes, 'application/pdf');
