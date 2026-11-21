/**
 * Page-range parsing and split planning. Page numbers in user input are 1-based;
 * everything returned is 0-based page indices.
 */

export type RangeResult = { ok: true; ranges: number[][] } | { ok: false; error: string };

/**
 * Parse "1-3,5,8-10" into groups of 0-based indices: [[0,1,2],[4],[7,8,9]].
 * Accepts spaces, en/em dashes, "-" open ends ("8-" = 8..last, "-3" = 1..3) and "last"/"end".
 * Reverse ranges ("5-3") are allowed and produce descending pages.
 */
export function parsePageRanges(input: string, pageCount: number): RangeResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter at least one page or range, e.g. 1-3,5' };
  if (pageCount < 1) return { ok: false, error: 'The document has no pages.' };
  const parts = text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: 'Enter at least one page or range, e.g. 1-3,5' };

  const toNum = (s: string, fallback: number): number | null => {
    const t = s.trim().toLowerCase();
    if (t === '') return fallback;
    if (t === 'last' || t === 'end') return pageCount;
    if (!/^\d+$/.test(t)) return null;
    return Number(t);
  };

  const ranges: number[][] = [];
  for (const part of parts) {
    const m = part.split(/\s*[-–—]\s*/);
    if (m.length > 2) return { ok: false, error: `"${part}" isn't a valid range.` };
    const from = toNum(m[0], 1);
    const to = m.length === 2 ? toNum(m[1], pageCount) : from;
    if (from === null || to === null) return { ok: false, error: `"${part}" isn't a page number or range.` };
    for (const n of [from, to]) {
      if (n < 1 || n > pageCount) {
        return { ok: false, error: `Page ${n} is out of range (the document has ${pageCount} page${pageCount === 1 ? '' : 's'}).` };
      }
    }
    const group: number[] = [];
    const step = from <= to ? 1 : -1;
    for (let p = from; step > 0 ? p <= to : p >= to; p += step) group.push(p - 1);
    ranges.push(group);
  }
  return { ok: true, ranges };
}

/** Flattened, de-duplicated pages in first-seen order (for "extract pages 1-3,5"). */
export function flattenRanges(ranges: number[][]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of ranges) for (const p of r) if (!seen.has(p)) { seen.add(p); out.push(p); }
  return out;
}

/** Split into chunks of N pages: (7, 3) → [[0,1,2],[3,4,5],[6]]. */
export function planSplitEvery(pageCount: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1) throw new Error('Pages per file must be a whole number of at least 1.');
  const out: number[][] = [];
  for (let start = 0; start < pageCount; start += n) {
    const group: number[] = [];
    for (let p = start; p < Math.min(start + n, pageCount); p++) group.push(p);
    out.push(group);
  }
  return out;
}

/** Human label for a group of 0-based indices: [0,1,2] → "1-3", [4] → "5", [0,2] → "1,3". */
export function describePages(group: number[]): string {
  if (group.length === 0) return '';
  const parts: string[] = [];
  let start = group[0];
  let prev = group[0];
  for (let i = 1; i <= group.length; i++) {
    const cur = group[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    start = cur;
    prev = cur;
  }
  return parts.join(',');
}

/** File names for a split: "report_p1-3.pdf", "report_p5.pdf". */
export function splitFileNames(base: string, groups: number[][]): string[] {
  return groups.map((g) => `${base}_p${describePages(g).replace(/,/g, '_')}.pdf`);
}
