/**
 * Multi-line bracket pairs for the editors' fold gutter. One linear pass that skips strings,
 * comments and `{{variable}}` placeholders, so `"id": {{destinationId}}` never looks like two
 * opening braces. Used instead of the JSON grammar's folding, which a placeholder confuses.
 */
export interface BracketPair {
  /** Offset of the opening bracket. */
  open: number;
  /** Offset of the closing bracket. */
  close: number;
}

/**
 * Returns a function telling whether there's a line break strictly between two offsets.
 * Newlines are indexed once and looked up by binary search; calling `lastIndexOf('\n', …)` per
 * bracket was quadratic on long single-line text (minified responses) and froze the page.
 */
export function newlineIndex(text: string): (from: number, to: number) => boolean {
  const nl: number[] = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) nl.push(i);
  return (from, to) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo < nl.length && nl[lo] < to;
  };
}

/** Bracket pairs, sorted by the opening offset. Only multi-line pairs unless `singleLine` is set. */
export function bracketPairs(text: string, opts: { comments?: boolean; singleLine?: boolean } = {}): BracketPair[] {
  const comments = opts.comments ?? true;
  const spansLines = opts.singleLine ? null : newlineIndex(text);
  const pairs: BracketPair[] = [];
  const stack: { ch: string; at: number }[] = [];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      // Strings end at the closing quote or the end of the line (a lone quote shouldn't swallow the rest).
      for (i++; i < n; i++) {
        const d = text[i];
        if (d === '\\') i++;
        else if (d === c || (d === '\n' && c !== '`')) break;
      }
      continue;
    }
    if (comments && c === '/' && text[i + 1] === '/') {
      const e = text.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (comments && c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === '{' && text[i + 1] === '{') {
      const e = text.indexOf('}}', i + 2);
      const inner = e < 0 ? '' : text.slice(i + 2, e);
      if (inner && !/[{}\n]/.test(inner)) {
        i = e + 1;
        continue;
      }
    }
    if (c === '{' || c === '[' || c === '(') stack.push({ ch: c, at: i });
    else if (c === '}' || c === ']' || c === ')') {
      const want = c === '}' ? '{' : c === ']' ? '[' : '(';
      // Tolerate stray closers: pop to the nearest matching opener, if any.
      let k = stack.length - 1;
      while (k >= 0 && stack[k].ch !== want) k--;
      if (k < 0) continue;
      const o = stack[k];
      stack.length = k;
      if (!spansLines || spansLines(o.at, i)) pairs.push({ open: o.at, close: i });
    }
  }
  return pairs.sort((a, b) => a.open - b.open);
}
