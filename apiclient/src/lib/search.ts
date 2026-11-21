/**
 * Top-bar search over the active workspace's collections: request names, URLs and saved
 * responses (examples: name, status and body). Case-insensitive; every word of the query must
 * appear in the same field. Pure, so it's tested without the UI.
 */
import { walkItems } from './postman/items';
import { requestObject, urlObject } from './postman/edit';
import { collectionId, isItemGroup } from './postman/normalize';
import type { PmCollection, PmItem } from './postman/types';

import type { SearchFieldPref } from './prefs';

export type SearchField = SearchFieldPref;
export const SEARCH_FIELDS: { id: SearchField; label: string }[] = [
  { id: 'name', label: 'Request names' },
  { id: 'url', label: 'URLs' },
  { id: 'response', label: 'Saved responses' },
];

export interface SearchOptions {
  /** Only this collection; null = all. */
  cid: string | null;
  fields: SearchField[];
  /** Stop after this many results. */
  limit?: number;
}

/** Text around a match: `before` + `match` + `after`, already trimmed for display. */
export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  kind: 'request' | 'response';
  cid: string;
  collectionName: string;
  iid: string;
  /** Saved response (example) id, for kind 'response'. */
  eid?: string;
  method: string;
  /** Request name, and for a response its example name. */
  name: string;
  exampleName?: string;
  /** Folder names from the collection root down. */
  path: string[];
  /** Fields that matched, in SEARCH_FIELDS order. */
  matched: SearchField[];
  /** Where the first matched field matched. */
  snippet: Snippet;
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Index range of the first word's match when every word occurs in `text`, else null. */
function findAll(text: string, terms: string[]): [number, number] | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let first: [number, number] | null = null;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i < 0) return null;
    if (!first) first = [i, i + t.length];
  }
  return first;
}

/** A one-line excerpt around [start, end), at most ~`width` characters. */
export function snippetOf(text: string, [start, end]: [number, number], width = 90): Snippet {
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  const room = Math.max(10, width - (end - start));
  const from = Math.max(0, start - Math.floor(room / 3));
  const to = Math.min(text.length, end + room - (start - from));
  return {
    before: (from > 0 ? '…' : '') + flat(text.slice(from, start)),
    match: flat(text.slice(start, end)),
    after: flat(text.slice(end, to)) + (to < text.length ? '…' : ''),
  };
}

export function searchCollections(collections: PmCollection[], query: string, opts: SearchOptions): SearchResult[] {
  const terms = words(query);
  const limit = opts.limit ?? 200;
  const out: SearchResult[] = [];
  if (!terms.length || !opts.fields.length) return out;
  const want = new Set(opts.fields);
  for (const c of collections) {
    const cid = collectionId(c);
    if (opts.cid && opts.cid !== cid) continue;
    walkItems(c.item, ({ item, parents }) => {
      if (out.length >= limit) return false;
      if (isItemGroup(item)) return;
      const it = item as PmItem;
      const req = requestObject(it);
      const base = { cid, collectionName: c.info.name, iid: it.id!, method: (req.method ?? 'GET').toUpperCase(), name: it.name ?? '', path: parents.map((p) => p.name ?? '') };
      const matched: SearchField[] = [];
      let snippet: Snippet | null = null;
      if (want.has('name')) {
        const m = findAll(base.name, terms);
        if (m) {
          matched.push('name');
          snippet ??= snippetOf(base.name, m);
        }
      }
      if (want.has('url')) {
        const raw = urlObject(req).raw ?? '';
        const m = findAll(raw, terms);
        if (m) {
          matched.push('url');
          snippet ??= snippetOf(raw, m);
        }
      }
      if (matched.length) out.push({ kind: 'request', ...base, matched, snippet: snippet! });
      if (want.has('response')) {
        for (const ex of it.response ?? []) {
          if (out.length >= limit) break;
          if (!ex.id) continue;
          const status = [ex.code, ex.status].filter(Boolean).join(' ');
          // Name and status first (short, most telling), then the body.
          const fields = [ex.name ?? '', status, ex.body ?? ''];
          for (const text of fields) {
            const m = findAll(text, terms);
            if (m) {
              out.push({ kind: 'response', ...base, eid: ex.id, exampleName: ex.name ?? 'Example', matched: ['response'], snippet: snippetOf(text, m) });
              break;
            }
          }
        }
      }
    });
    if (out.length >= limit) break;
  }
  return out;
}
