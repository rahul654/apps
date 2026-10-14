export type ExportFormat = 'png' | 'webp' | 'jpeg';

export const FORMAT_INFO: Record<ExportFormat, { label: string; mime: string; ext: string; alpha: boolean }> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', alpha: true },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', alpha: true },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', alpha: false },
};

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** File name without its extension, made safe for downloads and zip entries. */
export function baseName(name: string): string {
  const noExt = name.replace(/\.[^./\\]+$/, '');
  const clean = noExt.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
  return clean || 'image';
}

/** "photo.jpg" → "photo-nobg.png"; adds " (2)", " (3)"… if the name is already in `taken` (which it updates). */
export function outputName(name: string, format: ExportFormat, taken?: Set<string>): string {
  const base = `${baseName(name)}-nobg`;
  const ext = FORMAT_INFO[format].ext;
  let candidate = `${base}.${ext}`;
  for (let n = 2; taken?.has(candidate.toLowerCase()); n++) candidate = `${base} (${n}).${ext}`;
  taken?.add(candidate.toLowerCase());
  return candidate;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
