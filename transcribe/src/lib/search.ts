/** Transcript search and playback lookup. Pure. */
import type { Segment } from '../types';

/** Case- and accent-insensitive form for matching ("Café" matches "cafe"). */
export function foldText(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
}

/** Indices of segments whose text contains every word of the query (in any order). */
export function searchSegments(segments: Pick<Segment, 'text'>[], query: string): number[] {
  const terms = foldText(query).trim().split(' ').filter(Boolean);
  if (!terms.length) return [];
  const out: number[] = [];
  segments.forEach((s, i) => {
    const t = foldText(s.text);
    if (terms.every((term) => t.includes(term))) out.push(i);
  });
  return out;
}

/**
 * Splits text into plain and matching parts for highlighting. Matching is accent- and
 * case-insensitive but the returned parts are the original characters.
 */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const terms = foldText(query).trim().split(' ').filter(Boolean);
  if (!terms.length || !text) return [{ text, match: false }];
  // Map each original character to its folded form so offsets line up.
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = foldText(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(text.length);
  const marks = new Uint8Array(text.length);
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      const a = map[at];
      const b = map[at + term.length] ?? text.length;
      for (let i = a; i < b; i++) marks[i] = 1;
    }
  }
  const parts: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; ) {
    const m = marks[i] === 1;
    let j = i;
    while (j < text.length && (marks[j] === 1) === m) j++;
    parts.push({ text: text.slice(i, j), match: m });
    i = j;
  }
  return parts;
}

/**
 * The segment playing at time t: the last segment that has started, as long as t is before its
 * end (or before the next segment starts, so short gaps don't flicker). -1 before the first.
 * Segments must be sorted by start.
 */
export function activeSegmentIndex(segments: Pick<Segment, 'start' | 'end'>[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found === -1) return -1;
  const s = segments[found];
  const next = segments[found + 1];
  if (t < s.end || (next && t < next.start && t - s.end < 1.5)) return found;
  return t - s.end < 0.25 ? found : -1;
}
