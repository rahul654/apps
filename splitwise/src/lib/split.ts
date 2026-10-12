import type { ID, Share, SplitMethod } from '../types';

/** Splits `total` evenly; leftover minor units go to the first people so the sum is exact. */
export function splitEqually(total: number, ids: ID[]): Share[] {
  if (ids.length === 0) return [];
  const base = Math.floor(total / ids.length);
  let remainder = total - base * ids.length;
  return ids.map((personId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { personId, amount: base + extra };
  });
}

/** Splits `total` proportionally to weights (largest-remainder rounding, so the sum is exact). */
export function splitByWeights(total: number, weights: Array<[ID, number]>): Share[] {
  const positive = weights.filter(([, w]) => w > 0);
  const weightSum = positive.reduce((s, [, w]) => s + w, 0);
  if (weightSum <= 0) return [];

  const parts = positive.map(([personId, w]) => {
    const exact = (total * w) / weightSum;
    const floor = Math.floor(exact);
    return { personId, floor, frac: exact - floor };
  });
  const amounts = parts.map((p) => p.floor);
  let remainder = total - amounts.reduce((s, a) => s + a, 0);
  const order = parts.map((_, i) => i).sort((a, b) => parts[b].frac - parts[a].frac || a - b);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    amounts[order[k]] += 1;
    remainder -= 1;
  }
  return parts.map((p, i) => ({ personId: p.personId, amount: amounts[i] }));
}

export type SplitResult = { ok: true; shares: Share[] } | { ok: false; error: string };

export function computeSplit(
  method: SplitMethod,
  total: number,
  participants: ID[],
  inputs: Record<ID, number>,
): SplitResult {
  switch (method) {
    case 'equal': {
      const ids = participants.filter((id) => inputs[id] !== 0);
      if (ids.length === 0) return { ok: false, error: 'Select at least one person to split with.' };
      return { ok: true, shares: splitEqually(total, ids) };
    }
    case 'exact': {
      const shares = participants
        .map((personId) => ({ personId, amount: Math.round(inputs[personId] ?? 0) }))
        .filter((s) => s.amount > 0);
      const sum = shares.reduce((s, x) => s + x.amount, 0);
      if (sum !== total) return { ok: false, error: "The exact amounts don't add up to the total." };
      return { ok: true, shares };
    }
    case 'percent': {
      const entries = participants.map((id): [ID, number] => [id, inputs[id] ?? 0]);
      const sum = entries.reduce((s, [, p]) => s + p, 0);
      if (Math.abs(sum - 100) > 0.001) return { ok: false, error: "The percentages don't add up to 100%." };
      return { ok: true, shares: splitByWeights(total, entries) };
    }
    case 'shares': {
      const entries = participants.map((id): [ID, number] => [id, inputs[id] ?? 0]);
      if (entries.every(([, s]) => s <= 0)) return { ok: false, error: 'Give at least one person a share.' };
      return { ok: true, shares: splitByWeights(total, entries) };
    }
  }
}
