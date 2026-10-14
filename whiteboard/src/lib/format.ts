import type { BoardMeta } from './types';
import type { SortMode } from './prefs';

export const DEFAULT_TITLE = 'Untitled board';
export const MAX_TITLE = 100;

/** Trims, collapses whitespace, strips control characters and caps the length. */
export function normalizeTitle(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, MAX_TITLE).join('').trim();
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** `base`, or `base 2`, `base 3`… whichever is not taken (case-insensitive). */
export function uniqueTitle(base: string, existing: Iterable<string>): string {
  const clean = normalizeTitle(base) || DEFAULT_TITLE;
  const taken = new Set([...existing].map(fold));
  if (!taken.has(fold(clean))) return clean;
  const root = clean.replace(/ \d+$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${root} ${n}`;
    if (!taken.has(fold(candidate))) return candidate;
  }
}

/** "Plan" → "Plan (copy)", then "Plan (copy 2)"… Copying a copy doesn't stack suffixes. */
export function copyTitle(title: string, existing: Iterable<string>): string {
  const root = normalizeTitle(title).replace(/ \(copy(?: \d+)?\)$/, '') || DEFAULT_TITLE;
  const taken = new Set([...existing].map(fold));
  const first = `${root} (copy)`;
  if (!taken.has(fold(first))) return first;
  for (let n = 2; ; n++) {
    const candidate = `${root} (copy ${n})`;
    if (!taken.has(fold(candidate))) return candidate;
  }
}

/** "Q3 plan.excalidraw" → "Q3 plan". */
export function titleFromFileName(name: string): string {
  return normalizeTitle(name.replace(/\.(excalidraw|json|excalidrawlib)$/i, '').replace(/[_]+/g, ' '));
}

/** Safe file name for downloads. */
export function fileNameFor(title: string, ext: string): string {
  const base = normalizeTitle(title).replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'board';
  return `${base}.${ext}`;
}

/** Every whitespace-separated term must appear in the title (case- and accent-insensitive). */
export function searchBoards<T extends Pick<BoardMeta, 'title'>>(boards: readonly T[], query: string): T[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...boards];
  return boards.filter((b) => {
    const t = fold(b.title);
    return terms.every((term) => t.includes(term));
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortBoards<T extends Pick<BoardMeta, 'title' | 'createdAt' | 'updatedAt' | 'id'>>(boards: readonly T[], mode: SortMode): T[] {
  const list = [...boards];
  const tie = (a: T, b: T) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id);
  if (mode === 'name') return list.sort(tie);
  if (mode === 'created') return list.sort((a, b) => b.createdAt - a.createdAt || tie(a, b));
  return list.sort((a, b) => b.updatedAt - a.updatedAt || tie(a, b));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "Mar 3", "Mar 3, 2024". */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(ts);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday.getTime() - ts) / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
