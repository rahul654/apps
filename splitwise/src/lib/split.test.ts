import { describe, expect, it } from 'vitest';
import { computeSplit, splitByWeights, splitEqually } from './split';

const sum = (s: { amount: number }[]) => s.reduce((a, x) => a + x.amount, 0);

describe('splitEqually', () => {
  it('gives leftover minor units to the first people and keeps the total exact', () => {
    expect(splitEqually(1000, ['a', 'b', 'c']).map((s) => s.amount)).toEqual([334, 333, 333]);
  });
  it('returns nothing for no people', () => {
    expect(splitEqually(1000, [])).toEqual([]);
  });
});

describe('splitByWeights', () => {
  it('splits proportionally with an exact total', () => {
    const shares = splitByWeights(10000, [['a', 1], ['b', 2], ['c', 3]]);
    expect(sum(shares)).toBe(10000);
    expect(shares.map((s) => s.amount)).toEqual([1667, 3333, 5000]);
  });
  it('ignores zero weights', () => {
    expect(splitByWeights(500, [['a', 0], ['b', 1]])).toEqual([{ personId: 'b', amount: 500 }]);
  });
});

describe('computeSplit', () => {
  const people = ['a', 'b', 'c'];
  it('equal skips excluded people', () => {
    const r = computeSplit('equal', 900, people, { a: 1, b: 0, c: 1 });
    expect(r.ok && r.shares).toEqual([{ personId: 'a', amount: 450 }, { personId: 'c', amount: 450 }]);
  });
  it('exact must match the total', () => {
    expect(computeSplit('exact', 900, people, { a: 300, b: 300, c: 200 }).ok).toBe(false);
    expect(computeSplit('exact', 900, people, { a: 300, b: 300, c: 300 }).ok).toBe(true);
  });
  it('percent must add up to 100', () => {
    expect(computeSplit('percent', 1000, people, { a: 50, b: 30, c: 10 }).ok).toBe(false);
    const r = computeSplit('percent', 1000, people, { a: 33.33, b: 33.33, c: 33.34 });
    expect(r.ok && sum(r.shares)).toBe(1000);
  });
  it('shares needs at least one share', () => {
    expect(computeSplit('shares', 1000, people, {}).ok).toBe(false);
    const r = computeSplit('shares', 1000, people, { a: 2, b: 1, c: 1 });
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([500, 250, 250]);
  });
});
