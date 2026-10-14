/** Time formatting. Pure. */

/** Whole milliseconds, never negative; NaN/Infinity become 0. */
export function toMillis(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * 1000);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * `HH:MM:SS<sep>mmm`, rounded to the nearest millisecond before splitting, so 59.9996 s is
 * `00:01:00.000` rather than `00:00:59.1000`. SRT uses `,` and WebVTT uses `.`.
 * Hours keep growing past 99 (`100:00:00,000`), which both formats accept.
 */
export function formatTimestamp(seconds: number, sep: ',' | '.' = '.'): string {
  const ms = toMillis(seconds);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export const srtTime = (s: number) => formatTimestamp(s, ',');
export const vttTime = (s: number) => formatTimestamp(s, '.');

/** Player-style clock: `0:05`, `12:34`, `1:02:03`. Truncates (a clock shows elapsed whole seconds). */
export function formatClock(seconds: number): string {
  const total = Math.floor(toMillis(seconds) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Short human duration for lists: `45 s`, `3 min 05 s`, `1 h 02 min`. */
export function formatDuration(seconds: number): string {
  const total = Math.round(toMillis(seconds) / 1000);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return `${h} h ${pad(m)} min`;
  return `${m} min ${pad(total % 60)} s`;
}

/** Spoken form for aria-labels: "1 minute 5 seconds". */
export function spokenTime(seconds: number): string {
  const total = Math.floor(toMillis(seconds) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !parts.length) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
  const v = bytes / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "1 segment", "2 segments". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
