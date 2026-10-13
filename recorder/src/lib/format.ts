const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 65_000 → "1:05", 3_725_000 → "1:02:05". Negative / NaN → "0:00". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Seconds with one decimal for trim handles: 65.25 → "1:05.2". */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const tenths = Math.floor(seconds * 10 + 1e-6);
  const s = Math.floor(tenths / 10);
  return `${formatDuration(s * 1000)}.${tenths % 10}`;
}

/** Spoken form for screen readers: "1 minute 5 seconds". */
export function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || parts.length === 0) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** 1536 → "1.5 KB" (binary units, as the OS shows file sizes). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')} ${units[i]}`;
}

/** "Recording 2026-10-13 14:05" in local time. */
export function defaultTitle(d: Date): string {
  return `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Title → safe download filename with extension. Strips characters Windows/macOS reject. */
export function safeFilename(title: string, ext: string): string {
  const base = title
    .replace(/[:]/g, '-')
    .replace(/[\\/*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return `${base || 'Recording'}.${ext.replace(/^\./, '')}`;
}

/** Local date + time for the library list. */
export function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(ts).toISOString();
  }
}
