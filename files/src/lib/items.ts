// Items as the Apps Script lists them, and the Google Drive URLs used to show them.

export type Item = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** ISO time */
  created: string;
  kind: 'file' | 'text';
  /** First ~300 characters, for text items */
  preview?: string;
};

export type Library = { items: Item[]; used: number; limit: number };

const ID = /^[\w-]{1,200}$/;

/** Validates one item from the script; null when unusable. */
export function parseItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID.test(r.id) || typeof r.name !== 'string') return null;
  const size = Number(r.size);
  const item: Item = {
    id: r.id,
    name: r.name,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : '',
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    created: typeof r.created === 'string' ? r.created : '',
    kind: r.kind === 'text' ? 'text' : 'file',
  };
  if (item.kind === 'text') item.preview = typeof r.preview === 'string' ? r.preview : '';
  return item;
}

/** Validates a `list` reply; drops unusable items. */
export function parseLibrary(raw: unknown): Library {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.map(parseItem).filter((i): i is Item => i !== null) : [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { items, used: num(r.used), limit: num(r.limit) };
}

export type Category = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

export function categoryOf(item: Pick<Item, 'kind' | 'mimeType' | 'name'>): Category {
  if (item.kind === 'text') return 'text';
  const t = item.mimeType.toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf') return 'pdf';
  return 'other';
}

export const ICONS: Record<Category, string> = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', text: '📝', other: '📄' };

export type Filter = 'all' | 'media' | 'text' | 'other';

export function matchesFilter(item: Item, filter: Filter): boolean {
  const c = categoryOf(item);
  if (filter === 'media') return c === 'image' || c === 'video' || c === 'audio';
  if (filter === 'text') return c === 'text';
  if (filter === 'other') return c === 'pdf' || c === 'other';
  return true;
}

export type MediaUrls = {
  /** Small picture for the grid (images, videos, PDFs); may 404 while Drive is still processing */
  thumb?: string;
  /** Large picture for the viewer (images) */
  full?: string;
  /** Embeddable player/viewer page (video, audio, PDF, other files) */
  preview: string;
  download: string;
  /** The file's own Drive page */
  open: string;
};

/**
 * URLs for a file shared "anyone with the link can view". With `mockBase` (local mock server)
 * they point there instead, with the same shapes.
 */
export function mediaUrls(item: Pick<Item, 'id' | 'kind' | 'mimeType' | 'name'>, mockBase = ''): MediaUrls {
  const id = encodeURIComponent(item.id);
  const c = categoryOf(item);
  const hasThumb = c === 'image' || c === 'video' || c === 'pdf';
  if (mockBase) {
    const b = mockBase.replace(/\/$/, '');
    return {
      thumb: hasThumb ? `${b}/thumb/${id}` : undefined,
      full: c === 'image' ? `${b}/media/${id}` : undefined,
      preview: `${b}/preview/${id}`,
      download: `${b}/media/${id}?download`,
      open: `${b}/preview/${id}`,
    };
  }
  return {
    thumb: hasThumb ? `https://drive.google.com/thumbnail?id=${id}&sz=w480` : undefined,
    full: c === 'image' ? `https://drive.google.com/thumbnail?id=${id}&sz=w2000` : undefined,
    preview: `https://drive.google.com/file/d/${id}/preview`,
    download: `https://drive.google.com/uc?export=download&id=${id}`,
    open: `https://drive.google.com/file/d/${id}/view`,
  };
}
