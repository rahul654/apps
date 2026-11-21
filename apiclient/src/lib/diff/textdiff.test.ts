import { describe, expect, it } from 'vitest';
import { diffLines, diffSequences, diffWords, splitLines, toSideBySide, unifiedDiff } from './textdiff';

const seq = (s: string) => Int32Array.from(s, (c) => c.charCodeAt(0));

/** Apply runs to `a` using `b` and check we get `b` back; return the edit count. */
function check(a: string, b: string) {
  const { runs } = diffSequences(seq(a), seq(b));
  let i = 0;
  let j = 0;
  let out = '';
  let edits = 0;
  for (const r of runs) {
    if (r.type === 'equal') {
      expect(a.slice(i, i + r.count)).toBe(b.slice(j, j + r.count));
      out += a.slice(i, i + r.count);
      i += r.count;
      j += r.count;
    } else if (r.type === 'delete') {
      i += r.count;
      edits += r.count;
    } else {
      out += b.slice(j, j + r.count);
      j += r.count;
      edits += r.count;
    }
  }
  expect(out).toBe(b);
  expect(i).toBe(a.length);
  return edits;
}

describe('Myers diff', () => {
  it('finds the shortest edit script (classic ABCABBA / CBABAC = 5)', () => {
    expect(check('ABCABBA', 'CBABAC')).toBe(5);
  });
  it('handles empty, identical and disjoint inputs', () => {
    expect(check('', '')).toBe(0);
    expect(check('abc', 'abc')).toBe(0);
    expect(check('', 'abc')).toBe(3);
    expect(check('abc', '')).toBe(3);
    expect(check('abc', 'xyz')).toBe(6);
  });
  it('is minimal on random strings (compared with LCS DP)', () => {
    const lcs = (a: string, b: string) => {
      const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
      for (let x = 1; x <= a.length; x++) for (let y = 1; y <= b.length; y++) dp[x][y] = a[x - 1] === b[y - 1] ? dp[x - 1][y - 1] + 1 : Math.max(dp[x - 1][y], dp[x][y - 1]);
      return dp[a.length][b.length];
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let t = 0; t < 200; t++) {
      const mk = () => Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcd'[Math.floor(rnd() * 4)]).join('');
      const a = mk();
      const b = mk();
      expect(check(a, b)).toBe(a.length + b.length - 2 * lcs(a, b));
    }
  });
  it('splits on unique anchors when Myers gives up, staying correct', () => {
    // Many scattered edits in a long sequence: exceeds maxD, so patience anchors are used.
    const a = Int32Array.from({ length: 5000 }, (_, i) => i);
    const b = Int32Array.from(a, (v, i) => (i % 50 === 0 ? -1 - i : v));
    const r = diffSequences(a, b, 20);
    expect(r.exact).toBe(true);
    let eq = 0;
    for (const run of r.runs) if (run.type === 'equal') eq += run.count;
    expect(eq).toBe(5000 - 100);
  });
  it('falls back (exact=false) when the edit distance exceeds maxD', () => {
    const r = diffSequences(seq('aaaaaaaaaa'), seq('bbbbbbbbbb'), 3);
    expect(r.exact).toBe(false);
    expect(r.runs).toEqual([
      { type: 'delete', count: 10 },
      { type: 'insert', count: 10 },
    ]);
  });
});

describe('diffLines', () => {
  const a = 'one\ntwo\nthree\nfour\n';
  const b = 'one\n2\nthree\nfour\nfive\n';
  it('produces numbered lines and stats', () => {
    const d = diffLines(a, b);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.lines.map((l) => `${l.type[0]}${l.oldNo ?? '-'}:${l.newNo ?? '-'} ${l.text}`)).toEqual(['e1:1 one', 'd2:- two', 'i-:2 2', 'e3:3 three', 'e4:4 four', 'i-:5 five']);
  });
  it('adds word-level segments to paired changed lines', () => {
    const d = diffLines('const a = 1;', 'const b = 1;');
    expect(d.lines[0].words).toEqual([
      { text: 'const ', changed: false },
      { text: 'a', changed: true },
      { text: ' = 1;', changed: false },
    ]);
    expect(d.lines[1].words?.find((w) => w.changed)?.text).toBe('b');
  });
  it('ignores whitespace and case when asked', () => {
    expect(diffLines('a  b\nC', 'a b \nc', { ignoreWhitespace: true, ignoreCase: true }).added).toBe(0);
    expect(diffLines('a  b', 'a b').added).toBe(1);
  });
  it('splits CRLF and drops the final empty line', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
  });
  it('side-by-side pairs deletes with inserts', () => {
    const rows = toSideBySide(diffLines(a, b).lines);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['one', 'one'],
      ['two', '2'],
      ['three', 'three'],
      ['four', 'four'],
      [null, 'five'],
    ]);
  });
  it('builds a unified diff', () => {
    expect(unifiedDiff(diffLines(a, b).lines, 1)).toBe('--- original\n+++ modified\n@@ -1,4 +1,5 @@\n one\n-two\n+2\n three\n four\n+five\n');
    expect(unifiedDiff(diffLines('x', 'x').lines)).toBe('');
    const many = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const changed = [...many];
    changed[2] = 'X';
    changed[17] = 'Y';
    const u = unifiedDiff(diffLines(many.join('\n'), changed.join('\n')).lines, 2);
    expect(u.match(/^@@.*$/gm)).toEqual(['@@ -1,5 +1,5 @@', '@@ -16,5 +16,5 @@']);
  });
  it('diffWords on identical input has no changes', () => {
    expect(diffWords('same text', 'same text').old).toEqual([{ text: 'same text', changed: false }]);
  });
});
