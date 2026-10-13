// Myers O(ND) diff for lines and words, plus side-by-side rows and a unified patch.

export type OpType = 'equal' | 'delete' | 'insert';

/** A run of `count` items: equal (both advance), delete (old advances) or insert (new advances). */
export interface Run {
  type: OpType;
  count: number;
}

/**
 * Myers O(ND) shortest edit script for a[aLo..aHi) vs b[bLo..bHi), forward order.
 * Returns null when the edit distance exceeds `maxD` or the work exceeds `budget`
 * (keeps time and the O(D²) trace memory bounded).
 */
function myers(a: ArrayLike<number>, aLo: number, aHi: number, b: ArrayLike<number>, bLo: number, bHi: number, maxD: number, budget: number): OpType[] | null {
  const N = aHi - aLo;
  const M = bHi - bLo;
  const max = N + M;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  let work = 0;
  const limit = Math.min(max, maxD);
  for (let d = 0; d <= limit; d++) {
    // Save v[-d..d] (from the previous round) for backtracking.
    trace.push(v.slice(offset - d, offset + d + 1));
    work += 2 * d + 1;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      while (x < N && y < M && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      work += x - x0;
      v[offset + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
    if (found >= 0 || work > budget) break;
  }
  if (found < 0) return null;
  // Backtrack from (N, M) to (0, 0) collecting single steps in reverse.
  const steps: OpType[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const vd = trace[d]; // values after round d-1, indexed k + d
    const get = (k: number) => vd[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push('equal');
      x--;
      y--;
    }
    steps.push(prevK === k + 1 ? 'insert' : 'delete');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push('equal');
    x--;
    y--;
  }
  return steps.reverse();
}

/**
 * Patience-style anchors: elements occurring exactly once in both ranges, reduced to the
 * longest subsequence that is increasing in both (LIS). Returned as [aIndex, bIndex] pairs.
 */
function uniqueAnchors(a: ArrayLike<number>, aLo: number, aHi: number, b: ArrayLike<number>, bLo: number, bHi: number): [number, number][] {
  const countA = new Map<number, number>();
  for (let i = aLo; i < aHi; i++) countA.set(a[i], (countA.get(a[i]) ?? 0) + 1);
  const countB = new Map<number, number>();
  const posB = new Map<number, number>();
  for (let j = bLo; j < bHi; j++) {
    countB.set(b[j], (countB.get(b[j]) ?? 0) + 1);
    posB.set(b[j], j);
  }
  const pairs: [number, number][] = [];
  for (let i = aLo; i < aHi; i++) {
    if (countA.get(a[i]) === 1 && countB.get(a[i]) === 1) pairs.push([i, posB.get(a[i])!]);
  }
  if (pairs.length === 0) return [];
  // LIS on bIndex (pairs are already sorted by aIndex).
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < pairs[p][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[p] = tails[lo - 1];
    tails[lo] = p;
  }
  const out: [number, number][] = [];
  for (let p = tails[tails.length - 1]; p >= 0; p = prev[p]) out.push(pairs[p]);
  return out.reverse();
}

/**
 * Diff two integer sequences. Uses Myers (minimal) when the edit distance is moderate; for
 * large, scattered changes it splits on unique common elements (patience diff) and diffs the
 * gaps. Only when no anchors exist and Myers gives up is a block reported as delete-all +
 * insert-all, with `exact` set to false.
 */
export function diffSequences(a: ArrayLike<number>, b: ArrayLike<number>, maxD = 2000, budget = 5_000_000): { runs: Run[]; exact: boolean } {
  const runs: Run[] = [];
  let exact = true;
  const add = (type: OpType, count: number) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.count += count;
    else runs.push({ type, count });
  };

  const rec = (aLo: number, aHi: number, bLo: number, bHi: number) => {
    let pre = 0;
    while (aLo + pre < aHi && bLo + pre < bHi && a[aLo + pre] === b[bLo + pre]) pre++;
    let suf = 0;
    while (suf < aHi - aLo - pre && suf < bHi - bLo - pre && a[aHi - 1 - suf] === b[bHi - 1 - suf]) suf++;
    add('equal', pre);
    const lo = aLo + pre;
    const hi = aHi - suf;
    const blo = bLo + pre;
    const bhi = bHi - suf;
    if (lo === hi) add('insert', bhi - blo);
    else if (blo === bhi) add('delete', hi - lo);
    else {
      const steps = myers(a, lo, hi, b, blo, bhi, maxD, budget);
      if (steps) for (const st of steps) add(st, 1);
      else {
        const anchors = uniqueAnchors(a, lo, hi, b, blo, bhi);
        if (anchors.length === 0) {
          exact = false;
          add('delete', hi - lo);
          add('insert', bhi - blo);
        } else {
          let pa = lo;
          let pb = blo;
          for (const [ai, bi] of anchors) {
            rec(pa, ai, pb, bi);
            add('equal', 1);
            pa = ai + 1;
            pb = bi + 1;
          }
          rec(pa, hi, pb, bhi);
        }
      }
    }
    add('equal', suf);
  };

  rec(0, a.length, 0, b.length);
  return { runs, exact };
}

/** Map strings to integer ids so the diff compares numbers, not strings. */
function intern(items: string[], keys: Map<string, number>, keyOf: (s: string) => string): Int32Array {
  const out = new Int32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const k = keyOf(items[i]);
    let id = keys.get(k);
    if (id === undefined) {
      id = keys.size;
      keys.set(k, id);
    }
    out[i] = id;
  }
  return out;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export interface WordSeg {
  text: string;
  changed: boolean;
}

const TOKEN_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

/** Word-level diff of two lines; returns highlighted segments for each side. */
export function diffWords(oldLine: string, newLine: string): { old: WordSeg[]; new: WordSeg[] } {
  const ta = tokenize(oldLine);
  const tb = tokenize(newLine);
  if (ta.length + tb.length > 4000) return { old: [{ text: oldLine, changed: true }], new: [{ text: newLine, changed: true }] };
  const keys = new Map<string, number>();
  const { runs } = diffSequences(intern(ta, keys, (s) => s), intern(tb, keys, (s) => s), 1000);
  const oldSegs: WordSeg[] = [];
  const newSegs: WordSeg[] = [];
  const push = (arr: WordSeg[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1];
    if (last && last.changed === changed) last.text += text;
    else arr.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  for (const r of runs) {
    for (let c = 0; c < r.count; c++) {
      if (r.type === 'equal') {
        push(oldSegs, ta[i++], false);
        push(newSegs, tb[j++], false);
      } else if (r.type === 'delete') push(oldSegs, ta[i++], true);
      else push(newSegs, tb[j++], true);
    }
  }
  return { old: oldSegs, new: newSegs };
}

export interface DiffLine {
  type: OpType;
  oldNo?: number;
  newNo?: number;
  text: string;
  /** Word-level segments for changed lines that were paired with a counterpart. */
  words?: WordSeg[];
}

export interface LineDiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  exact: boolean;
}

export function diffLines(oldText: string, newText: string, opts: LineDiffOptions = {}): LineDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const keyOf = (s: string) => {
    let k = opts.ignoreWhitespace ? s.replace(/\s+/g, ' ').trim() : s;
    if (opts.ignoreCase) k = k.toLowerCase();
    return k;
  };
  const keys = new Map<string, number>();
  const { runs, exact } = diffSequences(intern(a, keys, keyOf), intern(b, keys, keyOf));
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.type === 'equal') {
      for (let c = 0; c < run.count; c++) lines.push({ type: 'equal', oldNo: ++i, newNo: ++j, text: b[j - 1] });
      continue;
    }
    // Collect a change block: deletes followed by inserts (in either order from the runs).
    let dels = 0;
    let ins = 0;
    while (r < runs.length && runs[r].type !== 'equal') {
      if (runs[r].type === 'delete') dels += runs[r].count;
      else ins += runs[r].count;
      r++;
    }
    r--;
    const delLines: DiffLine[] = [];
    const insLines: DiffLine[] = [];
    for (let c = 0; c < dels; c++) delLines.push({ type: 'delete', oldNo: ++i, text: a[i - 1] });
    for (let c = 0; c < ins; c++) insLines.push({ type: 'insert', newNo: ++j, text: b[j - 1] });
    const pairs = Math.min(dels, ins);
    if (pairs <= 500) {
      for (let p = 0; p < pairs; p++) {
        const w = diffWords(delLines[p].text, insLines[p].text);
        delLines[p].words = w.old;
        insLines[p].words = w.new;
      }
    }
    for (const l of delLines) lines.push(l);
    for (const l of insLines) lines.push(l);
    added += ins;
    removed += dels;
  }
  return { lines, added, removed, exact };
}

export interface SideRow {
  left?: DiffLine;
  right?: DiffLine;
}

/** Pair deletions with insertions so a side-by-side view lines them up. */
export function toSideBySide(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let k = 0;
  while (k < lines.length) {
    const l = lines[k];
    if (l.type === 'equal') {
      rows.push({ left: l, right: l });
      k++;
      continue;
    }
    const dels: DiffLine[] = [];
    const ins: DiffLine[] = [];
    while (k < lines.length && lines[k].type !== 'equal') {
      (lines[k].type === 'delete' ? dels : ins).push(lines[k]);
      k++;
    }
    for (let p = 0; p < Math.max(dels.length, ins.length); p++) rows.push({ left: dels[p], right: ins[p] });
  }
  return rows;
}

/** Indices of lines to show when hiding unchanged lines beyond `context` lines of a change. */
export function visibleWithContext(lines: DiffLine[], context: number): boolean[] {
  const show = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'equal') {
      for (let c = Math.max(0, i - context); c <= Math.min(lines.length - 1, i + context); c++) show[c] = true;
    }
  }
  return show;
}

/** Unified diff (patch) text with `context` lines around each hunk. */
export function unifiedDiff(lines: DiffLine[], context = 3, oldName = 'original', newName = 'modified'): string {
  if (!lines.some((l) => l.type !== 'equal')) return '';
  const show = visibleWithContext(lines, context);
  const out = [`--- ${oldName}`, `+++ ${newName}`];
  let i = 0;
  while (i < lines.length) {
    if (!show[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && show[end]) end++;
    const hunk = lines.slice(i, end);
    // Line numbers before the hunk: count lines of each side preceding index i.
    let oldStart = 0;
    let newStart = 0;
    for (let p = 0; p < i; p++) {
      if (lines[p].type !== 'insert') oldStart++;
      if (lines[p].type !== 'delete') newStart++;
    }
    const oldLen = hunk.filter((l) => l.type !== 'insert').length;
    const newLen = hunk.filter((l) => l.type !== 'delete').length;
    const range = (start: number, len: number) => (len === 0 ? `${start},0` : len === 1 ? `${start + 1}` : `${start + 1},${len}`);
    out.push(`@@ -${range(oldStart, oldLen)} +${range(newStart, newLen)} @@`);
    for (const l of hunk) out.push((l.type === 'equal' ? ' ' : l.type === 'delete' ? '-' : '+') + l.text);
    i = end;
  }
  return out.join('\n') + '\n';
}
