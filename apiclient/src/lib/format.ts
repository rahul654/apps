export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatTime(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' });
}

export function relativeTime(iso: string | number, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

/** Pretty-print JSON text; returns null when it is not JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function safeFileName(name: string, fallback = 'file'): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
  return s || fallback;
}
