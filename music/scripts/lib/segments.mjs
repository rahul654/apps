/**
 * Pure helpers that turn YouTube's "Most replayed" heatmap into clip segments
 * (contract: src/types.ts Segment / Song). No I/O here; scripts/extract-segments.mjs does the fetching.
 */

/**
 * @typedef {{ start_time: number, end_time: number, value: number }} HeatmapBucket
 * @typedef {{ rank: number, start: number, end: number, score: number, edited?: boolean }} Segment
 * @typedef {{ videoId: string, title: string, name: string, artist: string, duration: number,
 *   source: 'heatmap' | 'fallback', heatmap: number[], segments: Segment[] }} Song
 */

/** Default tuning for findSegments. Every field can be overridden through `opts`. */
export const DEFAULTS = Object.freeze({
  /** Buckets starting before this (s) are ignored: everyone presses play, so 0–2 s is always the max. */
  introSkip: 8,
  /**
   * After introSkip, also drop buckets while the smoothed curve is still falling: that is the tail of
   * the play-button spike (or a "skip to the vocals" bump), not a hook.
   */
  skipIntroDecay: true,
  /** Buckets ending in the last N seconds are ignored. */
  outroSkip: 5,
  /** Moving-average width in buckets (odd). */
  smoothWindow: 3,
  /** A local maximum is a candidate when its smoothed value is ≥ this share of the post-intro max. */
  peakRatio: 0.55,
  /** …and stands out from the valleys around it by at least this share of the post-intro max. */
  minProminence: 0.05,
  /** A window grows left/right while the smoothed curve stays ≥ this share of its peak value. */
  growRatio: 0.85,
  /** Clip length bounds in seconds. */
  minLength: 20,
  maxLength: 45,
  /** At most this many segments per song. */
  maxSegments: 3,
});

/** Length of the clip fallbackSegment returns (s). */
export const FALLBACK_LENGTH = 30;
/** fallbackSegment starts the clip at this share of the song. */
export const FALLBACK_AT = 0.3;

const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Moving average over `values`, using only the neighbours that exist at the edges.
 * @param {number[]} values
 * @param {number} width odd window width
 * @returns {number[]}
 */
export function smooth(values, width) {
  const half = Math.max(0, Math.floor(width / 2));
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j];
      count++;
    }
    return sum / count;
  });
}

/**
 * Topographic prominence of the local maximum at `i`: how far it rises above the higher of the two
 * lowest points between it and the nearest higher value on each side (or the curve's end).
 * @param {number[]} s
 * @param {number} i
 * @returns {number}
 */
function prominence(s, i) {
  const peak = s[i];
  let leftMin = peak;
  for (let j = i - 1; j >= 0 && s[j] <= peak; j--) leftMin = Math.min(leftMin, s[j]);
  let rightMin = peak;
  for (let j = i + 1; j < s.length && s[j] <= peak; j++) rightMin = Math.min(rightMin, s[j]);
  const leftOpen = i === 0 || s.slice(0, i).every((v) => v <= peak);
  const rightOpen = i === s.length - 1 || s.slice(i + 1).every((v) => v <= peak);
  // The global maximum has no higher ground on either side: measure against the deeper valley.
  if (leftOpen && rightOpen) return peak - Math.min(leftMin, rightMin);
  return peak - Math.max(leftMin, rightMin);
}

/**
 * Places a clip of `length` seconds centred on `centre`, shifted to stay inside [lo, hi].
 * @returns {[number, number]}
 */
function centredWindow(centre, length, lo, hi) {
  let start = centre - length / 2;
  start = clamp(start, lo, Math.max(lo, hi - length));
  return [start, Math.min(hi, start + length)];
}

/**
 * Finds the most-replayed stretches of a song.
 *
 * Steps: drop the intro spike and the outro, smooth, take local maxima that are high and prominent
 * enough, grow each into a window while the curve stays near its peak, clamp the window to
 * minLength–maxLength seconds around the peak, drop windows that overlap or touch a stronger one,
 * keep the best `maxSegments`.
 *
 * @param {HeatmapBucket[]} heatmap yt-dlp's `heatmap` (≈100 evenly spaced buckets, values 0..1)
 * @param {number} duration song length in seconds
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {Segment[]} sorted by rank (1 = most replayed, score 1); empty when the curve is unusable
 */
export function findSegments(heatmap, duration, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!Array.isArray(heatmap) || !(duration > 0)) return [];
  let usable = heatmap.filter(
    (b) =>
      Number.isFinite(b.start_time) &&
      Number.isFinite(b.end_time) &&
      Number.isFinite(b.value) &&
      b.start_time >= o.introSkip &&
      b.end_time <= duration - o.outroSkip,
  );
  if (usable.length === 0) return [];

  // Clips stay out of the intro unless the song is too short for that.
  const lo = duration - o.introSkip >= o.minLength ? o.introSkip : 0;
  const hi = Math.floor(duration);
  if (hi - lo < 1) return [];

  let s = smooth(
    usable.map((b) => b.value),
    o.smoothWindow,
  );
  if (o.skipIntroDecay) {
    let first = 0;
    while (first < s.length - 1 && s[first + 1] < s[first]) first++;
    // A curve that only ever falls has no hook to find: keep it whole rather than end up empty.
    if (first < s.length - 1) {
      usable = usable.slice(first);
      s = s.slice(first);
    }
  }
  const max = Math.max(...s);
  if (!(max > 0)) return [];

  const candidates = [];
  for (let i = 0; i < s.length; i++) {
    const left = i === 0 ? -Infinity : s[i - 1];
    const right = i === s.length - 1 ? -Infinity : s[i + 1];
    // `>=` on the left so a flat-topped peak counts once (at its first bucket).
    if (!(s[i] >= left && s[i] > right)) continue;
    if (s[i] < o.peakRatio * max) continue;
    const isGlobalMax = s[i] === max;
    if (!isGlobalMax && prominence(s, i) < o.minProminence * max) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) candidates.push(s.indexOf(max));

  const windows = candidates.map((i) => {
    const floor = o.growRatio * s[i];
    let a = i;
    while (a > 0 && s[a - 1] >= floor) a--;
    let b = i;
    while (b < s.length - 1 && s[b + 1] >= floor) b++;
    const centre = (usable[i].start_time + usable[i].end_time) / 2;
    let start = usable[a].start_time;
    let end = usable[b].end_time;
    const length = end - start;
    if (length < o.minLength) {
      [start, end] = centredWindow(centre, o.minLength, lo, hi);
    } else if (length > o.maxLength) {
      // Trim to maxLength around the peak, but stay inside the grown stretch.
      [start, end] = centredWindow(centre, o.maxLength, Math.max(lo, start), Math.min(hi, end));
    } else {
      [start, end] = [Math.max(lo, start), Math.min(hi, end)];
      if (end - start < o.minLength) [start, end] = centredWindow(centre, o.minLength, lo, hi);
    }
    return { start, end, score: s[i] / max };
  });

  const kept = [];
  for (const w of windows.sort((x, y) => y.score - x.score)) {
    const seg = toWholeSeconds(w, o, lo, hi);
    if (kept.some((k) => seg.start <= k.end && k.start <= seg.end)) continue;
    kept.push(seg);
    if (kept.length === o.maxSegments) break;
  }
  return kept.map((k, idx) => ({ rank: idx + 1, start: k.start, end: k.end, score: round2(k.score) }));
}

/** Rounds a window to whole seconds while keeping its length within bounds and inside [lo, hi]. */
function toWholeSeconds(w, o, lo, hi) {
  let start = Math.round(w.start);
  let end = Math.round(w.end);
  const minLen = Math.min(o.minLength, hi - lo);
  if (end - start > o.maxLength) end = start + o.maxLength;
  if (end - start < minLen) end = start + minLen;
  if (end > hi) {
    start -= end - hi;
    end = hi;
  }
  if (start < lo) {
    end = Math.min(hi, end + (lo - start));
    start = lo;
  }
  return { start, end, score: w.score };
}

/**
 * One guessed clip for songs without heatmap data: FALLBACK_LENGTH seconds from ~30% into the song.
 * @param {number} duration seconds
 * @returns {Segment[]} exactly one segment with score 0
 */
export function fallbackSegment(duration) {
  const total = Math.max(1, Math.floor(duration));
  const length = Math.min(FALLBACK_LENGTH, total);
  const start = clamp(Math.round(total * FALLBACK_AT), 0, total - length);
  return [{ rank: 1, start, end: start + length, score: 0 }];
}

/**
 * The contract's compact heatmap: raw bucket values rounded to 2 decimals, in time order.
 * @param {HeatmapBucket[] | null | undefined} heatmap
 * @returns {number[]}
 */
export function compactHeatmap(heatmap) {
  if (!Array.isArray(heatmap)) return [];
  return [...heatmap]
    .sort((a, b) => a.start_time - b.start_time)
    .map((b) => round2(clamp(Number(b.value) || 0, 0, 1)));
}

/**
 * Keeps hand edits from the previous catalog when a song is regenerated: the old `name`/`artist`
 * (when non-empty) and every old segment marked `edited: true`. New segments that overlap an edited
 * one are dropped; the rest fill up to 3 segments in total (edited ones are never dropped, even past 3).
 * Ranks are reassigned 1..n by score (edited first on ties).
 * @param {Song} newSong
 * @param {Song | null | undefined} oldSong the same videoId from the existing catalog
 * @returns {Song}
 */
export function mergeWithExisting(newSong, oldSong) {
  if (!oldSong) return newSong;
  const name = oldSong.name ? oldSong.name : newSong.name;
  const artist = oldSong.artist ? oldSong.artist : newSong.artist;
  const edited = (oldSong.segments ?? []).filter((s) => s.edited === true);
  if (edited.length === 0) return { ...newSong, name, artist };

  const room = Math.max(0, DEFAULTS.maxSegments - edited.length);
  const fresh = newSong.segments
    .filter((s) => !edited.some((e) => s.start < e.end && e.start < s.end))
    .slice(0, room);
  const all = [...edited.map((s) => ({ ...s, edited: true })), ...fresh.map((s) => ({ ...s }))];
  const ranked = all
    .map((s, order) => ({ s, order }))
    .sort((a, b) => b.s.score - a.s.score || a.order - b.order)
    .map(({ s }, i) => ({ ...s, rank: i + 1 }));
  return { ...newSong, name, artist, segments: ranked };
}

const BRACKET_NOISE =
  /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|lyrical|full\s*song|hd|4k|remaster(?:ed)?|visuali[sz]er|music\s*video|song)\b[^)\]]*)[)\]]/gi;
const TAIL_NOISE =
  /\s*[-–:]?\s*\b(?:full\s+video\s+song|full\s+song|official\s+(?:music\s+)?video|official\s+audio|lyric(?:al)?\s+video|video\s+song|full\s+hd|romantic\s+song|old\s+hindi\s+songs?|\(song\))\b.*$/i;
const FEAT = /\s*\(?\b(?:ft|feat|featuring)\.?\s+[^)|]*\)?/i;

/**
 * Best-effort display name and artist from a YouTube title. Handles "Artist - Song (Official Video)",
 * "Song - Film | cast | composer", "Song (Song): Singer | Film", "Artist: Song ft. X [OFFICIAL VIDEO]".
 * Good enough as a default; names can be fixed by hand in catalog.json and are kept on re-runs.
 * @param {string} title
 * @returns {{ name: string, artist: string }}
 */
export function cleanTitle(title) {
  const raw = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { name: '', artist: '' };

  const parts = raw.split(/\s+\|\s+|\s+l\s+(?=[A-Z])/);
  let head = parts[0];
  const tail = parts.slice(1);

  // "Song (Song): Singer, Composer" → the part after the colon is the artist.
  let colonArtist = '';
  const songColon = head.match(/^(.*?)\s*\((?:song|audio|video)\)\s*:\s*(.+)$/i);
  if (songColon) {
    head = songColon[1];
    colonArtist = songColon[2];
  }

  // "SONG (Official Video) Artist" → the text after a noise bracket is the artist.
  let bracketArtist = '';
  const mid = head.match(new RegExp(`^(.+?)${BRACKET_NOISE.source}\\s+(.+)$`, 'i'));
  if (mid && !/[-–:]/.test(mid[1])) {
    head = mid[1];
    bracketArtist = mid[2];
  }

  head = head.replace(BRACKET_NOISE, '').replace(FEAT, '').replace(TAIL_NOISE, '').trim();

  let name = head;
  let artist = colonArtist || bracketArtist;
  const dash = head.split(/\s+[-–—]\s+/);
  const colon = head.match(/^([^:]{2,40}?)\s*:\s*(.+)$/);
  if (dash.length >= 2) {
    // "Artist - Song" (English) or "Song - Film" (Hindi titles followed by a "| cast" tail).
    const songFirst = tail.length > 0;
    name = songFirst ? dash[0] : dash.slice(1).join(' - ');
    artist = artist || (songFirst ? dash.slice(1).join(' - ') : dash[0]);
  } else if (colon && !songColon) {
    artist = colon[1];
    name = colon[2];
  }

  if (!artist && tail.length > 0) {
    artist = tail
      .map((t) => t.replace(BRACKET_NOISE, '').replace(TAIL_NOISE, '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
  }
  const tidy = (t) =>
    t
      .replace(BRACKET_NOISE, '')
      .replace(FEAT, '')
      .replace(/\s*[-–:|]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  return { name: titleCaseIfShouting(tidy(name)) || raw, artist: tidy(artist) };
}

/** "JO TUM MERE HO" → "Jo Tum Mere Ho"; mixed-case names are left alone. */
function titleCaseIfShouting(text) {
  if (!/[A-Z]/.test(text) || text !== text.toUpperCase() || text.replace(/[^A-Z]/g, '').length < 4) return text;
  return text.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}
