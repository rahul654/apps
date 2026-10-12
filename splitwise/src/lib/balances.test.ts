import { describe, expect, it } from 'vitest';
import type { Expense, Group } from '../types';
import {
  allTransfers, balanceBetween, expenseTransfers, ledgerFromTransfers, netBalances, pairwiseTransfers, simplifyDebts,
} from './balances';

let seq = 0;
function exp(paid: Record<string, number>, owed: Record<string, number>, groupId: string | null = null): Expense {
  const amount = Object.values(paid).reduce((a, b) => a + b, 0);
  return {
    id: String(++seq), kind: 'expense', description: 'x', amount, date: '2026-01-01', groupId, category: 'general',
    paidBy: Object.entries(paid).map(([personId, amount]) => ({ personId, amount })),
    owedBy: Object.entries(owed).map(([personId, amount]) => ({ personId, amount })),
    splitMethod: 'exact', splitInputs: {}, notes: '', createdAt: '', updatedAt: '',
  };
}

describe('balances', () => {
  it('single payer: everyone else owes the payer their share', () => {
    const t = expenseTransfers(exp({ a: 300 }, { a: 100, b: 100, c: 100 }));
    expect(t).toEqual([
      { from: 'b', to: 'a', amount: 100 },
      { from: 'c', to: 'a', amount: 100 },
    ]);
  });

  it('multiple payers: debtors owe creditors proportionally', () => {
    // a paid 200, b paid 100; each owes 100 → a is +100, c is -100.
    const t = expenseTransfers(exp({ a: 200, b: 100 }, { a: 100, b: 100, c: 100 }));
    expect(t).toEqual([{ from: 'c', to: 'a', amount: 100 }]);
  });

  it('a payment cancels the debt', () => {
    const ledger = ledgerFromTransfers(
      pairwiseTransfers([exp({ a: 200 }, { a: 100, b: 100 }), exp({ b: 100 }, { a: 100 })]),
    );
    expect(balanceBetween(ledger, 'a', 'b')).toBe(0);
  });

  it('simplify collapses chains', () => {
    const net = netBalances([exp({ b: 10 }, { a: 10 }), exp({ c: 10 }, { b: 10 })]);
    expect(simplifyDebts(net)).toEqual([{ from: 'a', to: 'c', amount: 10 }]);
  });

  it('allTransfers keeps per-person net totals regardless of simplification', () => {
    const g: Group = { id: 'g', name: 'g', type: 'trip', memberIds: ['a', 'b', 'c'], simplifyDebts: true, createdAt: '' };
    const expenses = [exp({ b: 10 }, { a: 10 }, 'g'), exp({ c: 10 }, { b: 10 }, 'g'), exp({ a: 50 }, { c: 50 })];
    const ledger = ledgerFromTransfers(allTransfers([g], expenses));
    expect(balanceBetween(ledger, 'c', 'a')).toBe(10 - 50);
    expect(balanceBetween(ledger, 'a', 'b')).toBe(0);
  });
});
