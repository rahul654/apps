/** Human-readable file size, e.g. 0 B, 999 B, 1.0 KB, 12.3 MB. Uses 1024 steps (like OS file managers). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[i]}`;
}

/**
 * Percentage saved going from `before` to `after` bytes.
 * Positive = smaller output, negative = output grew. Returns 0 when before is 0.
 */
export function percentSaved(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 1000) / 10;
}

/** "−42.5% (saved)" style label. */
export function savedLabel(before: number, after: number): string {
  const p = percentSaved(before, after);
  if (p > 0) return `${p}% smaller`;
  if (p < 0) return `${Math.abs(p)}% larger`;
  return 'same size';
}

/** Strip the extension: "photo.final.jpg" → "photo.final". */
export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Lower-case extension without dot ("" when none). */
export function extName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Remove characters that are invalid in file names on common OSes. */
export function safeFileName(name: string, fallback = 'file'): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 180) || fallback;
}

/**
 * Make names unique within a batch (for ZIP entries):
 * ["a.png", "a.png", "a.png"] → ["a.png", "a (2).png", "a (3).png"]. Case-insensitive.
 */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = safeFileName(raw);
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const ext = extName(name);
      candidate = ext ? `${baseName(name)} (${n}).${ext}` : `${name} (${n})`;
      n++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Files bigger than this get a "may run out of memory" warning before processing. */
export const LARGE_FILE_BYTES = 200 * 1024 * 1024;
