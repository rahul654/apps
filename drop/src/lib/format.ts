const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB" (1024-based, like file managers). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`;
}

/** Bytes per second → "2.4 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds → "45 s", "3 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
