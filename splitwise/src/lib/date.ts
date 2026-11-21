const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD, optionally offset by whole days. */
export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function monthLabel(iso: string): string {
  return parseLocal(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function dateParts(iso: string): { month: string; day: number } {
  const d = parseLocal(iso);
  return { month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), day: d.getDate() };
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(isoDateTime: string): string {
  const seconds = Math.round((new Date(isoDateTime).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(seconds / 86400), 'day');
  return new Date(isoDateTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
