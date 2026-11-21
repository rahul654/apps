/**
 * Long-audio chunking and merging. Pure.
 *
 * Whisper sees at most 30 s at a time. Long audio is cut into overlapping windows (30 s with a
 * 5 s stride on each side, so consecutive windows share 10 s). Each window is transcribed on
 * its own; its timestamps are relative to the window start. A window's output is accepted
 * provisionally, and the next window's output is spliced onto it:
 *
 *  1. Offset to absolute time. An open-ended last item (end = null) ends at the window end.
 *  2. Text alignment (main rule): in the shared 10 s both windows heard the same speech, so
 *     their words line up. Find the longest run of identical words (case and punctuation
 *     ignored) between the tail of what's accepted and the head of the new window, and splice
 *     in the middle of that run: words before it come from the earlier window, words after it
 *     from the later one. The middle is used because both windows are least reliable at their
 *     own edges (cut-off words, drifting timestamps). This is the word-level version of what
 *     Hugging Face's pipeline does with tokens. Whisper's segment timestamps near a window edge
 *     can be several seconds off, so time alone isn't enough (an earlier version lost whole
 *     sentences that way).
 *     A run of 2 words is accepted only when it is exactly the end of one and the start of the other.
 *     The matched words must also be within 10 s of each other by each window's own timing:
 *     a refrain ("wir weben, wir weben") would otherwise match a later repeat and drop the
 *     verses in between.
 *  3. Time fallback, when the overlap has no such run (silence, music, or the
 *     windows disagree): cut at the midpoint of the overlap. Accepted items whose midpoint is
 *     past the cut are dropped; new items are kept if their midpoint is past the cut or they
 *     start after everything accepted has ended. A short repeated prefix (2+ words) is removed.
 */
import type { Segment, Word } from '../types';

export interface AudioWindow {
  index: number;
  /** Window span in seconds. */
  start: number;
  end: number;
  /** The span whose items this window keeps (see the time rule). */
  keepFrom: number;
  keepTo: number;
  last: boolean;
}

export const CHUNK_SECONDS = 30;
export const STRIDE_SECONDS = 5;

export function planWindows(duration: number, chunk = CHUNK_SECONDS, stride = STRIDE_SECONDS): AudioWindow[] {
  if (!(duration > 0)) return [];
  const step = chunk - 2 * stride;
  if (!(step > 0)) throw new Error('Stride too large for the chunk length.');
  const raw: { start: number; end: number }[] = [];
  for (let start = 0; ; start += step) {
    const end = Math.min(start + chunk, duration);
    raw.push({ start, end });
    if (end >= duration) break;
  }
  return raw.map((w, i) => {
    const prev = raw[i - 1];
    const next = raw[i + 1];
    return {
      index: i,
      start: w.start,
      end: w.end,
      keepFrom: prev ? (w.start + prev.end) / 2 : 0,
      keepTo: next ? (next.start + w.end) / 2 : Infinity,
      last: !next,
    };
  });
}

/** One item from Whisper for a window: a segment or a word, timestamps relative to the window. */
export interface RawChunk {
  text: string;
  timestamp: [number | null, number | null] | readonly [number | null, number | null];
}

export interface TimedItem {
  text: string;
  start: number;
  end: number;
}

/** Lower-case words with punctuation stripped, for comparing text across windows. */
export function normWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/**
 * Longest n (≤ max) such that the last n words of `tail` equal the first n words of `head`.
 */
export function overlapLength(tail: string[], head: string[], max = 12): number {
  const limit = Math.min(max, tail.length, head.length);
  for (let n = limit; n > 0; n--) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (tail[tail.length - n + i] !== head[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return n;
  }
  return 0;
}

/** Removes the first `n` normalised words from the text, keeping the rest as written. */
export function dropLeadingWords(text: string, n: number): string {
  if (n <= 0) return text;
  const tokens = text.match(/\S+\s*/g) ?? [];
  let removed = 0;
  let i = 0;
  while (i < tokens.length && removed < n) {
    if (normWords(tokens[i]).length) removed += normWords(tokens[i]).length;
    i++;
  }
  return tokens.slice(i).join('').trim();
}

export function toAbsolute(chunks: RawChunk[], w: Pick<AudioWindow, 'start' | 'end'>): TimedItem[] {
  const out: TimedItem[] = [];
  for (const c of chunks) {
    const [s, e] = c.timestamp;
    const start = w.start + (s ?? 0);
    let end = e == null ? w.end : w.start + e;
    end = Math.min(Math.max(end, start), Math.max(w.end, start));
    out.push({ text: c.text, start, end });
  }
  return out;
}

const SILENT_TEXT = /^\s*[[(]?\s*(blank_audio|silence|music|no speech)\s*[\])]?\s*$/i;

/** A word inside an item, for alignment. `norm` is '' for punctuation-only pieces. */
interface Token {
  item: number;
  /** Character offset of the piece inside the item's text. */
  at: number;
  norm: string;
  /** Rough time of the word: interpolated across its item by character position. */
  t: number;
}

function tokenize(items: TimedItem[], from: number): Token[] {
  const out: Token[] = [];
  for (let i = from; i < items.length; i++) {
    const re = /\S+/g;
    for (let m = re.exec(items[i].text); m; m = re.exec(items[i].text)) {
      const n = normWords(m[0]);
      // A piece like "well-known" stays one token; "—" alone has no words.
      const it = items[i];
      out.push({ item: i, at: m.index, norm: n.join(' '), t: it.start + ((it.end - it.start) * m.index) / Math.max(1, it.text.length) });
    }
  }
  return out.filter((t) => t.norm);
}

/** Longest common contiguous run of tokens: [startInA, startInB, length]. */
export function longestCommonRun(a: string[], b: string[]): [number, number, number] {
  let best: [number, number, number] = [0, 0, 0];
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        // Prefer the latest run in `a` on ties (closest to the join).
        if (cur[j] >= best[2]) best = [i - cur[j], j - cur[j], cur[j]];
      }
    }
    prev = cur;
  }
  return best;
}

const MIN_RUN = 3;
/** Matched words more than this many seconds apart (by each window's own timing) aren't the same speech. */
const MAX_DRIFT = 10;

/**
 * Where the two windows line up: the longest run of identical words whose middle words are
 * within MAX_DRIFT seconds of each other (refrains and repeated phrases otherwise match the
 * wrong occurrence). Ties go to the closest in time. A 2-word run only counts when it is
 * exactly the end of the tail and the start of the head. Returns [tailIndex, headIndex, length].
 */
function alignTokens(tail: Token[], head: Token[]): [number, number, number] {
  let best: [number, number, number] = [0, 0, 0];
  let bestDrift = Infinity;
  let prev = new Array<number>(head.length + 1).fill(0);
  for (let i = 1; i <= tail.length; i++) {
    const cur = new Array<number>(head.length + 1).fill(0);
    for (let j = 1; j <= head.length; j++) {
      if (tail[i - 1].norm !== head[j - 1].norm) continue;
      const len = (cur[j] = prev[j - 1] + 1);
      const ia = i - len;
      const ib = j - len;
      if (len < MIN_RUN && !(len === 2 && i === tail.length && ib === 0)) continue;
      const mid = Math.floor(len / 2);
      const drift = Math.abs(tail[ia + mid].t - head[ib + mid].t);
      if (drift > MAX_DRIFT) continue;
      if (len > best[2] || (len === best[2] && drift < bestDrift)) {
        best = [ia, ib, len];
        bestDrift = drift;
      }
    }
    prev = cur;
  }
  return best;
}
/** Seconds of slack around the overlap when picking words to align (timestamps drift near edges). */
const SLACK = 8;

/** Splits an item at a character offset (text before / from it), keeping its times. */
const before = (it: TimedItem, at: number): TimedItem => ({ ...it, text: it.text.slice(0, at).replace(/\s+$/, '') });
const from = (it: TimedItem, at: number): TimedItem => ({ ...it, text: (at > 0 ? ' ' : it.text.match(/^\s*/)![0]) + it.text.slice(at) });

/**
 * Merges one window's output into the accepted items (returns a new array).
 * `kind` matters only for splicing: a word is never cut, but a segment can be: its first part
 * comes from the earlier window and the rest from the later one, as two segments.
 */
export function mergeWindow(accepted: TimedItem[], chunks: RawChunk[], w: AudioWindow, kind: 'segment' | 'word'): TimedItem[] {
  const items = toAbsolute(chunks, w).filter((it) => it.text.trim() && !SILENT_TEXT.test(it.text));
  if (!accepted.length) return items.map((it) => ({ ...it }));
  if (!items.length) return accepted.slice();

  // 2. Text alignment over the overlap.
  const prevEnd = accepted[accepted.length - 1].end;
  let tailFrom = accepted.length;
  while (tailFrom > 0 && accepted[tailFrom - 1].end > w.start - SLACK) tailFrom--;
  let headTo = 0;
  while (headTo < items.length && items[headTo].start < Math.max(prevEnd, w.start) + SLACK) headTo++;
  const tail = tokenize(accepted, tailFrom);
  const head = tokenize(items.slice(0, headTo), 0);
  const [ia, ib, len] = alignTokens(tail, head);
  if (len >= 2) {
    // A 2-word overlap is exactly at the join: take both words from the later window.
    const mid = len === 2 ? 0 : Math.floor(len / 2);
    const ta = tail[ia + mid];
    const tb = head[ib + mid];
    const out = accepted.slice(0, ta.item);
    const keepA = before(accepted[ta.item], ta.at);
    const restB = from(items[tb.item], tb.at);
    if (keepA.text.trim()) {
      // The cut word's time, by the earlier window's clock, ends the first part and starts the second.
      const cutAt = Math.min(Math.max(ta.t, keepA.start), keepA.end);
      out.push({ ...keepA, end: kind === 'segment' ? cutAt : keepA.end });
      out.push({ ...restB, start: kind === 'segment' ? cutAt : Math.max(restB.start, keepA.start), end: Math.max(restB.end, cutAt) });
    } else {
      out.push({ ...restB, start: Math.max(restB.start, out.length ? out[out.length - 1].start : -Infinity) });
    }
    for (const it of items.slice(tb.item + 1)) out.push({ ...it });
    return monotonic(out, kind);
  }

  // 3. Time fallback.
  const cut = w.keepFrom;
  const out = accepted.filter((it) => (it.start + it.end) / 2 < cut);
  const lastEnd = out.length ? out[out.length - 1].end : -Infinity;
  const kept: TimedItem[] = [];
  for (const it of items) {
    const end = kept.length ? kept[kept.length - 1].end : lastEnd;
    if ((it.start + it.end) / 2 >= cut || it.start >= end - 0.2) kept.push({ ...it });
  }
  if (out.length && kept.length) {
    const n = overlapLength(normWords(out.slice(-8).map((a) => a.text).join(' ')), normWords(kept.slice(0, 8).map((k) => k.text).join(' ')));
    let left = n >= 2 ? n : 0;
    while (left > 0 && kept.length) {
      const words = normWords(kept[0].text).length;
      if (kind === 'word' || words <= left) {
        left -= Math.max(1, words);
        kept.shift();
      } else {
        kept[0] = { ...kept[0], text: (kept[0].text.match(/^\s*/)?.[0] ?? '') + dropLeadingWords(kept[0].text, left) };
        left = 0;
      }
    }
  }
  return monotonic([...out, ...kept], kind);
}

/** Keeps time order: nothing starts before the previous item; segments don't overlap. */
function monotonic(items: TimedItem[], kind: 'segment' | 'word'): TimedItem[] {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const it = items[i];
    if (it.start < prev.start) it.start = prev.start;
    if (kind === 'segment' && it.start < prev.end) it.start = Math.min(prev.end, it.end);
    if (it.end < it.start) it.end = it.start;
  }
  return items;
}

/**
 * Whisper sometimes gets stuck repeating a phrase ("who are living in, who are living in, …"),
 * especially small models and word-timestamp mode (which decodes without timestamp tokens).
 * Marks the extra copies: a phrase of 2–8 words repeated 3+ times in a row, or one word 5+ times.
 * Genuine repeats ("wir weben, wir weben", "no, no") are left alone.
 */
export function loopMask(words: string[]): boolean[] {
  const drop = new Array<boolean>(words.length).fill(false);
  const same = (a: number, b: number, k: number) => {
    for (let x = 0; x < k; x++) if (words[a + x] !== words[b + x]) return false;
    return true;
  };
  let i = 0;
  outer: while (i < words.length) {
    for (let k = 1; k <= 8 && i + 2 * k <= words.length; k++) {
      let r = 1;
      while (i + (r + 1) * k <= words.length && same(i, i + r * k, k)) r++;
      if (r >= (k === 1 ? 5 : 3)) {
        for (let x = i + k; x < i + r * k; x++) drop[x] = true;
        i += r * k;
        continue outer;
      }
    }
    i++;
  }
  return drop;
}

/** True if a window's output contains a repetition loop (see loopMask). */
export function hasLoop(chunks: RawChunk[]): boolean {
  return loopMask(normWords(chunks.map((c) => c.text).join(' '))).some(Boolean);
}

/** Removes repetition loops from a window's output, keeping one copy of the phrase. */
export function collapseLoops(chunks: RawChunk[]): RawChunk[] {
  const pieces: { chunk: number; text: string; norm: string }[] = [];
  chunks.forEach((c, ci) => {
    for (const m of c.text.match(/\S+/g) ?? []) {
      const n = normWords(m).join(' ');
      if (n) pieces.push({ chunk: ci, text: m, norm: n });
      else if (pieces.length && pieces[pieces.length - 1].chunk === ci) pieces[pieces.length - 1].text += ' ' + m;
    }
  });
  const drop = loopMask(pieces.map((p) => p.norm));
  if (!drop.some(Boolean)) return chunks;
  const kept = new Map<number, string[]>();
  pieces.forEach((p, i) => {
    if (!drop[i]) kept.set(p.chunk, [...(kept.get(p.chunk) ?? []), p.text]);
  });
  return chunks.flatMap((c, ci) => (kept.has(ci) ? [{ ...c, text: (/^\s/.test(c.text) ? ' ' : '') + kept.get(ci)!.join(' ') }] : []));
}

/**
 * Segment chunks → word chunks with times spread across each segment by character length.
 * Used when a window had to be re-decoded at segment level in word-timestamp mode.
 */
export function splitIntoWords(chunks: RawChunk[]): RawChunk[] {
  const out: RawChunk[] = [];
  for (const c of chunks) {
    const [s, e] = c.timestamp;
    const words = c.text.match(/\s*\S+/g) ?? [];
    const total = words.reduce((n, w) => n + w.trim().length, 0) || 1;
    let at = 0;
    for (const w of words) {
      const len = w.trim().length;
      const ws = s == null || e == null ? s : s + ((e - s) * at) / total;
      const we = s == null || e == null ? e : s + ((e - s) * (at + len)) / total;
      out.push({ text: w.startsWith(' ') ? w : ' ' + w, timestamp: [ws, we] });
      at += len;
    }
  }
  return out;
}

export interface SegmentOptions {
  /** Max characters per segment (two subtitle lines of ~42). */
  maxChars?: number;
  /** Max seconds per segment. */
  maxDuration?: number;
  /** A pause at least this long starts a new segment. */
  pause?: number;
}

const SENTENCE_END = /[.!?…。！？]["”’)\]]*\s*$/;
const CLAUSE_END = /[,;:，、；：—–]["”’)\]]*\s*$/;

/** Groups word timings into readable segments (sentence ends, pauses, length limits). */
export function wordsToSegments(words: Word[], opts: SegmentOptions = {}, idPrefix = 's'): Segment[] {
  const { maxChars = 84, maxDuration = 7, pause = 0.8 } = opts;
  const out: Segment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.text).join('').trim();
    if (text) out.push({ id: `${idPrefix}${out.length}`, start: cur[0].start, end: cur[cur.length - 1].end, text, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const chars = cur.reduce((n, x) => n + x.text.length, 0) + w.text.length;
      const tooLong = chars > maxChars || w.end - cur[0].start > maxDuration;
      if (w.start - prev.end >= pause || (SENTENCE_END.test(prev.text) && cur.length >= 3)) flush();
      else if (tooLong) {
        // Prefer to break after a comma in the second half rather than mid-phrase.
        let k = -1;
        for (let i = cur.length - 1; i >= Math.max(2, Math.floor(cur.length / 2)); i--) {
          if (CLAUSE_END.test(cur[i].text)) {
            k = i;
            break;
          }
        }
        if (k >= 0 && k < cur.length - 1) {
          const rest = cur.slice(k + 1);
          cur = cur.slice(0, k + 1);
          flush();
          cur = rest;
        } else flush();
      }
    }
    cur.push(w);
  }
  flush();
  return out;
}

export function itemsToSegments(items: TimedItem[], idPrefix = 's'): Segment[] {
  return items
    .map((it) => ({ text: it.text.trim(), start: it.start, end: it.end }))
    .filter((it) => it.text)
    .map((it, i) => ({ id: `${idPrefix}${i}`, ...it }));
}

/** Root-mean-square level of a block of samples. */
export function rms(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  const n = to - from;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

/** A window quieter than about −60 dBFS is skipped: Whisper tends to invent text ("Thank you.") for silence. */
export function isSilent(samples: ArrayLike<number>, from = 0, to = samples.length, threshold = 0.001): boolean {
  return rms(samples, from, to) < threshold;
}
