import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  splitIntoWords,
  collapseLoops,
  hasLoop,
  longestCommonRun,
  loopMask,
  dropLeadingWords,
  isSilent,
  itemsToSegments,
  mergeWindow,
  normWords,
  overlapLength,
  planWindows,
  toAbsolute,
  wordsToSegments,
  type RawChunk,
  type TimedItem,
} from './merge';

describe('planWindows', () => {
  it('short audio is one window that keeps everything', () => {
    expect(planWindows(12)).toEqual([{ index: 0, start: 0, end: 12, keepFrom: 0, keepTo: Infinity, last: true }]);
    expect(planWindows(30)).toHaveLength(1);
    expect(planWindows(0)).toEqual([]);
  });

  it('30 s windows step by 20 s (5 s stride each side); cuts sit mid-overlap', () => {
    const w = planWindows(65);
    expect(w.map((x) => [x.start, x.end])).toEqual([
      [0, 30],
      [20, 50],
      [40, 65],
    ]);
    expect(w.map((x) => [x.keepFrom, x.keepTo])).toEqual([
      [0, 25],
      [25, 45],
      [45, Infinity],
    ]);
    expect(w.map((x) => x.last)).toEqual([false, false, true]);
  });

  it('owned spans tile the whole duration without gaps or overlaps', () => {
    const w = planWindows(1234.5);
    expect(w[0].keepFrom).toBe(0);
    for (let i = 1; i < w.length; i++) expect(w[i].keepFrom).toBe(w[i - 1].keepTo);
    expect(w[w.length - 1].end).toBe(1234.5);
    // Every owned span lies inside its window, at least `stride` from inner edges.
    for (const x of w) {
      if (x.index > 0) expect(x.keepFrom - x.start).toBe(5);
      if (!x.last) expect(x.end - x.keepTo).toBe(5);
    }
  });

  it('rejects a stride that leaves no step', () => {
    expect(() => planWindows(100, 30, 15)).toThrow();
  });
});

describe('text helpers', () => {
  it('normalises words', () => {
    expect(normWords(' Hello, World! It’s ok… ')).toEqual(['hello', 'world', "it's", 'ok']);
    expect(normWords("don't -- stop")).toEqual(["don't", 'stop']);
  });
  it('finds suffix/prefix overlap', () => {
    expect(overlapLength(['a', 'b', 'c', 'd'], ['c', 'd', 'e'])).toBe(2);
    expect(overlapLength(['a', 'b'], ['x'])).toBe(0);
    expect(overlapLength(['x', 'x'], ['x', 'x', 'x'])).toBe(2);
  });
  it('drops leading words but keeps the rest as written', () => {
    expect(dropLeadingWords('the cat, sat on', 2)).toBe('sat on');
    expect(dropLeadingWords('— the cat', 1)).toBe('cat');
    expect(dropLeadingWords('one', 5)).toBe('');
  });
});

const seg = (text: string, s: number | null, e: number | null): RawChunk => ({ text, timestamp: [s, e] });
const texts = (items: TimedItem[]) => items.map((a) => a.text.trim());

describe('longestCommonRun', () => {
  it('finds the longest shared run, preferring the latest on ties', () => {
    expect(longestCommonRun(['a', 'b', 'c', 'd'], ['x', 'b', 'c', 'd', 'e'])).toEqual([1, 1, 3]);
    expect(longestCommonRun(['a', 'b'], ['c'])).toEqual([0, 0, 0]);
    expect(longestCommonRun(['x', 'y', 'q', 'x', 'y'], ['x', 'y'])).toEqual([3, 0, 2]);
  });
});

describe('mergeWindow (segments)', () => {
  const [w0, w1, w2] = planWindows(65);

  it('offsets times and closes an open-ended last item at the window end', () => {
    expect(toAbsolute([seg('x', 2, null)], w1)).toEqual([{ text: 'x', start: 22, end: 50 }]);
  });

  it('accepts the first window as is (provisionally)', () => {
    const acc = mergeWindow([], [seg(' One.', 0, 10), seg(' Two and', 10, null)], w0, 'segment');
    expect(acc).toEqual([
      { text: ' One.', start: 0, end: 10 },
      { text: ' Two and', start: 10, end: 30 },
    ]);
  });

  it('splices on the words both windows heard, in the middle of the shared run', () => {
    // Window 0 hears the last sentence cut off ("devo"); window 1 hears it in full but starts mid-sentence.
    let acc = mergeWindow([], [seg(' Intro.', 0, 15), seg(' for which they gave the last full measure of devo', 15, null)], w0, 'segment');
    acc = mergeWindow(acc, [seg(' they gave the last full measure of devotion,', 0, 7), seg(' that we here resolve.', 7, 14)], w1, 'segment');
    expect(texts(acc).join(' ')).toBe('Intro. for which they gave the last full measure of devotion, that we here resolve.');
    // Cut mid-run ("they gave the | last full measure of"): the first part keeps the earlier
    // window's start, the rest the later window's end.
    expect(texts(acc).slice(1, 3)).toEqual(['for which they gave the', 'last full measure of devotion,']);
    expect(acc[1].start).toBe(15);
    expect(acc[1].end).toBeGreaterThan(15);
    expect(acc[2]).toMatchObject({ start: acc[1].end, end: 27 });
  });

  it('trusts words over drifting timestamps near window edges', () => {
    // Real Whisper behaviour: window 1's first segment is stamped from 0 s but contains speech from
    // well before the window start. A time-only merge dropped "full measure of devotion".
    let acc = mergeWindow([], [seg(' these honored dead we take increased devotion to that cause, for which they gave the last', 17.5, 24.6), seg(' full measure of devotion.', 24.6, 27.2)], w0, 'segment');
    acc = mergeWindow(acc, [seg(' increased devotion to that cause for which they gave the last full measure of devotion,', 0, 7.2), seg(' that we here highly resolve', 7.2, 14.4)], w1, 'segment');
    const text = texts(acc).join(' ');
    expect(text).toBe('these honored dead we take increased devotion to that cause, for which they gave the last full measure of devotion, that we here highly resolve');
  });

  it('three windows in a row', () => {
    let acc = mergeWindow([], [seg(' One.', 0, 10), seg(' Two.', 10, 20), seg(' Three is long', 20, null)], w0, 'segment');
    acc = mergeWindow(acc, [seg(' Two. Three is long and done.', 0, 8), seg(' Four.', 8, 14), seg(' Five', 24, null)], w1, 'segment');
    acc = mergeWindow(acc, [seg(' Four. Five six seven.', 0, 6), seg(' Eight.', 12, 25)], w2, 'segment');
    expect(texts(acc).join(' ')).toBe('One. Two. Three is long and done. Four. Five six seven. Eight.');
    expect(acc.every((it, i) => i === 0 || it.start >= acc[i - 1].start)).toBe(true);
  });

  it('time fallback when the overlap shares no words: cut mid-overlap, fill gaps', () => {
    // Window 0 thinks "x y" is at [26,30] (past the cut at 25); window 1 hears different words at [20.5,24.5].
    let acc = mergeWindow([], [seg(' Start.', 0, 20), seg(' x y', 26, 30)], w0, 'segment');
    acc = mergeWindow(acc, [seg(' different words', 0.5, 4.5), seg(' after.', 6, 10)], w1, 'segment');
    expect(texts(acc)).toEqual(['Start.', 'different words', 'after.']);
  });

  it('two words are enough to splice when they are exactly at the join', () => {
    let acc = mergeWindow([], [seg(' It was late,', 0, 20), seg(' we went', 20, 24)], w0, 'segment');
    acc = mergeWindow(acc, [seg(' we went home.', 4, 7)], w1, 'segment');
    expect(texts(acc)).toEqual(['It was late,', 'we went home.']);
  });

  it('does not drop a genuinely repeated word', () => {
    let acc = mergeWindow([], [seg(' I said no', 0, 20)], w0, 'segment');
    acc = mergeWindow(acc, [seg(' no more.', 6, 10)], w1, 'segment');
    expect(texts(acc)).toEqual(['I said no', 'no more.']);
  });

  it('ignores empty and [BLANK_AUDIO] items', () => {
    const acc = mergeWindow([], [seg(' ', 0, 1), seg(' [BLANK_AUDIO]', 1, 30)], planWindows(30)[0], 'segment');
    expect(acc).toEqual([]);
  });
});

describe('mergeWindow on real Whisper output', () => {
  // Whisper Base (WASM) output for each 30 s window of LibriVox's public-domain reading of the
  // Gettysburg Address (2 min 38 s), recorded from this app in Chromium.
  const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/gettysburg-whisper-base-windows.json', import.meta.url), 'utf8')) as { start: number; end: number; chunks: [number, number | null, string][] }[];

  it('every phrase appears exactly once', () => {
    const windows = planWindows(fixture[fixture.length - 1].end);
    expect(windows.map((w) => w.start)).toEqual(fixture.map((f) => f.start));
    let acc: TimedItem[] = [];
    fixture.forEach((f, i) => {
      acc = mergeWindow(acc, f.chunks.map(([s, e, text]) => ({ text, timestamp: [s, e] as [number, number | null] })), windows[i], 'segment');
    });
    const text = normWords(acc.map((a) => a.text).join(' ')).join(' ');
    const phrases = [
      'four score and seven years ago',
      'all men are created equal',
      'now we are engaged in a great civil war',
      'and so dedicated can long endure',
      'final resting place for those who here gave their lives',
      'hallow this ground',
      'far above our poor power to add or detract',
      'what they did here',
      'thus far so nobly advanced',
      'the last full measure of devotion',
      'new birth of freedom',
      'for the people shall not perish from the earth',
      "end of lincoln's gettysburg address",
    ];
    for (const p of phrases) expect(text.split(p).length - 1, p).toBe(1);
    // No 6-word sequence is repeated anywhere (the address itself has none).
    const words = text.split(' ');
    const seen = new Set<string>();
    for (let i = 0; i + 6 <= words.length; i++) {
      const g = words.slice(i, i + 6).join(' ');
      expect(seen.has(g), g).toBe(false);
      seen.add(g);
    }
    expect(acc.every((it, i) => i === 0 || it.start >= acc[i - 1].start)).toBe(true);
    expect(itemsToSegments(acc).length).toBeGreaterThan(20);
  });
});

describe('mergeWindow with a refrain', () => {
  // Whisper Base output for LibriVox's public-domain German reading of Heine's "Die schlesischen
  // Weber" (1 min 29 s). Every verse ends "wir weben, wir weben", so the longest shared run
  // between windows 0 and 1 is the *next* verse's refrain; matching it dropped two verses.
  const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/weber-whisper-base-windows.json', import.meta.url), 'utf8')) as { start: number; end: number; chunks: [number, number | null, string][] }[];

  it('keeps every verse once', () => {
    const windows = planWindows(fixture[fixture.length - 1].end);
    let acc: TimedItem[] = [];
    fixture.forEach((f, i) => {
      acc = mergeWindow(acc, f.chunks.map(([s, e, text]) => ({ text, timestamp: [s, e] as [number, number | null] })), windows[i], 'segment');
    });
    const text = normWords(acc.map((a) => a.text).join(' ')).join(' ');
    for (const p of ['im düsteren auge keine träne', 'ein fluch dem gott', 'in winterskälte und hungersnöten', 'ein fluch dem könig', 'den letzten groschen', 'ein fluch dem falschen vaterlande', 'das schiff fliegt', 'wir weben emsichtag und nacht', 'ende von die schlesichen weber']) {
      expect(text.split(p).length - 1, p).toBe(1);
    }
  });
});

describe('mergeWindow (words) and grouping', () => {
  const [w0, w1] = planWindows(45);
  const word = (text: string, s: number, e: number | null): RawChunk => ({ text, timestamp: [s, e] });

  it('word merge across the join', () => {
    let acc = mergeWindow([], [word(' a', 21, 21.6), word(' b', 22.4, 23.4), word(' c', 25.6, 26.2), word(' d', 28, 29), word(' e', 29.5, null)], w0, 'word');
    acc = mergeWindow(acc, [word(' b', 2.5, 3.3), word(' c', 5.6, 6.2), word(' d', 8, 9), word(' e', 9.5, 10.2), word(' f', 10.5, 11)], w1, 'word');
    expect(acc.map((a) => a.text)).toEqual([' a', ' b', ' c', ' d', ' e', ' f']);
    // Words after the splice point come from the later window (complete timings).
    expect(acc[4]).toMatchObject({ start: 29.5, end: 30.2 });
  });

  it('groups words into segments at sentence ends, pauses and length limits', () => {
    const words = [
      { text: ' Hello', start: 0, end: 0.4 },
      { text: ' there,', start: 0.4, end: 0.8 },
      { text: ' friend.', start: 0.8, end: 1.2 },
      { text: ' How', start: 1.3, end: 1.5 },
      { text: ' are', start: 1.5, end: 1.7 },
      { text: ' you?', start: 1.7, end: 2 },
      { text: ' Fine', start: 4, end: 4.3 },
    ];
    const s = wordsToSegments(words);
    expect(s.map((x) => x.text)).toEqual(['Hello there, friend.', 'How are you?', 'Fine']);
    expect(s[1]).toMatchObject({ start: 1.3, end: 2 });
    expect(s[1].words).toHaveLength(3);
    // Over the limit: break after the comma in the second half, not mid-phrase.
    const jfk = ' And so my fellow Americans, ask not what your country can do for you, ask what you can do'.split(/(?= )/).map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
    expect(wordsToSegments(jfk, { maxDuration: 100, maxChars: 70 }).map((x) => x.text)).toEqual([
      'And so my fellow Americans, ask not what your country can do for you,',
      'ask what you can do',
    ]);
    const five = [' one', ' two', ' three,', ' four', ' five'].map((t, i) => ({ text: t, start: i, end: i + 0.9 }));
    expect(wordsToSegments(five, { maxChars: 22, maxDuration: 100 }).map((x) => x.text)).toEqual(['one two three,', 'four five']);
    const many = Array.from({ length: 40 }, (_, i) => ({ text: ' word', start: i * 0.3, end: i * 0.3 + 0.25 }));
    const g = wordsToSegments(many, { maxChars: 30, maxDuration: 100 });
    expect(g.every((x) => x.text.length <= 30)).toBe(true);
    expect(g.reduce((n, x) => n + x.words!.length, 0)).toBe(40);
  });
});

describe('repetition loops', () => {
  const w = (s: string) => normWords(s);
  it('marks extra copies of a looping phrase', () => {
    const words = w('that the people who are living in who are living in who are living in who are living in have consecrated it');
    const drop = loopMask(words);
    expect(words.filter((_, i) => !drop[i]).join(' ')).toBe('that the people who are living in have consecrated it');
  });
  it('leaves genuine repeats alone', () => {
    for (const t of ['wir weben, wir weben', 'no, no, no', 'of the people, by the people, for the people', 'that that nation', 'very very very very good']) {
      expect(loopMask(w(t)).some(Boolean), t).toBe(false);
    }
    expect(loopMask(w('la la la la la la')).filter(Boolean)).toHaveLength(5);
  });
  it('collapses loops in segment chunks and in word chunks', () => {
    const segs: RawChunk[] = [
      { text: ' It is fine. who are living in, who are living in,', timestamp: [0, 5] },
      { text: ' who are living in, who are living in, who are have consecrated it.', timestamp: [5, 10] },
    ];
    expect(hasLoop(segs)).toBe(true);
    const c = collapseLoops(segs);
    expect(c.map((x) => x.text)).toEqual([' It is fine. who are living in,', ' who are have consecrated it.']);
    expect(c[1].timestamp).toEqual([5, 10]);
    const words: RawChunk[] = ' a b c b c b c b c d'.split(/(?= )/).map((t, i) => ({ text: t, timestamp: [i, i + 1] }));
    expect(collapseLoops(words).map((x) => x.text.trim())).toEqual(['a', 'b', 'c', 'd']);
    expect(hasLoop([{ text: ' Four score and seven years ago', timestamp: [0, 3] }])).toBe(false);
  });
});

describe('splitIntoWords', () => {
  it('spreads a segment over its words by length', () => {
    const w = splitIntoWords([{ text: ' ab cd', timestamp: [10, 14] }]);
    expect(w).toEqual([
      { text: ' ab', timestamp: [10, 12] },
      { text: ' cd', timestamp: [12, 14] },
    ]);
    expect(splitIntoWords([{ text: 'x', timestamp: [3, null] }])).toEqual([{ text: ' x', timestamp: [3, null] }]);
  });
});

describe('silence', () => {
  it('detects near-silent windows', () => {
    expect(isSilent(new Float32Array(16000))).toBe(true);
    const noise = Float32Array.from({ length: 16000 }, (_, i) => 0.0002 * Math.sin(i));
    expect(isSilent(noise)).toBe(true);
    const speech = Float32Array.from({ length: 16000 }, (_, i) => 0.1 * Math.sin(i / 5));
    expect(isSilent(speech)).toBe(false);
    expect(isSilent(speech, 0, 0)).toBe(true);
  });
});
