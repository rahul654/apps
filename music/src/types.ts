/**
 * Data contract for src/data/catalog.json, written by scripts/extract-segments.mjs and read by the page.
 * Phase 2 will load the same shape from a Google Apps Script / Sheet instead of the bundled file
 * (one sheet row per segment: category, videoId, name, start, end, rank).
 */

/** One most-replayed stretch of a song ("an up"). Times are whole seconds from the start of the video. */
export interface Segment {
  /** 1 = most replayed. Ranks are 1..n with no gaps; `segments` is sorted by rank. */
  rank: number;
  start: number;
  /** Exclusive end; always > start and <= the song's duration. */
  end: number;
  /** Peak replay intensity of this stretch, 0..1 (1 = the song's most-replayed point after the intro). */
  score: number;
  /** Set by hand when someone fixed the clip; re-running the script keeps edited segments as they are. */
  edited?: boolean;
}

export interface Song {
  /** YouTube video id (11 chars). */
  videoId: string;
  /** Raw YouTube title, kept for reference. */
  title: string;
  /** Short display name, e.g. "Aaoge Tum Kabhi". Hand-editable; the script keeps an existing one. */
  name: string;
  /** Artist / film line under the name, e.g. "The Local Train". May be ''. Hand-editable. */
  artist: string;
  /** Seconds. */
  duration: number;
  /** 'heatmap' = segments from YouTube's "Most replayed" data; 'fallback' = no data, one guessed clip. */
  source: 'heatmap' | 'fallback';
  /** YouTube's "Most replayed" curve, evenly spaced over the song, values 0..1 rounded to 2 decimals. Empty for 'fallback'. */
  heatmap: number[];
  /** Sorted by rank. Never empty. The script writes 1–3; segments marked `edited` are always kept, so there can be more. */
  segments: Segment[];
}

export interface Category {
  /** URL-safe id used in routes: #/c/<id>. */
  id: string;
  title: string;
  /** Source YouTube playlist. */
  playlistId: string;
  songs: Song[];
}

export interface Catalog {
  version: 1;
  /** YYYY-MM-DD of the last script run ('stub' for the placeholder file). */
  generatedAt: string;
  categories: Category[];
}
