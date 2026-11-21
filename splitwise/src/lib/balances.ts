import type { Expense, Group, ID, Transfer } from '../types';
import { splitByWeights } from './split';

/** ledger.get(a).get(b) > 0 means b owes a that much. Antisymmetric. */
export type Ledger = Map<ID, Map<ID, number>>;

export interface ContextTransfer extends Transfer {
  /** Group the debt belongs to; null for expenses outside any group. */
  groupId: ID | null;
}

/** Net position per person: positive = gets money back, negative = owes. */
export function netBalances(expenses: Expense[]): Map<ID, number> {
  const net = new Map<ID, number>();
  const add = (id: ID, v: number) => net.set(id, (net.get(id) ?? 0) + v);
  for (const e of expenses) {
    for (const p of e.paidBy) add(p.personId, p.amount);
    for (const o of e.owedBy) add(o.personId, -o.amount);
  }
  return net;
}

/** Who owes whom for a single expense. Each debtor owes creditors in proportion to what they're owed. */
export function expenseTransfers(expense: Expense): Transfer[] {
  const net = [...netBalances([expense])];
  const creditors = net.filter(([, v]) => v > 0);
  const out: Transfer[] = [];
  for (const [debtor, v] of net) {
    if (v >= 0) continue;
    for (const s of splitByWeights(-v, creditors)) {
      if (s.amount > 0) out.push({ from: debtor, to: s.personId, amount: s.amount });
    }
  }
  return out;
}

export function ledgerFromTransfers(transfers: Transfer[]): Ledger {
  const ledger: Ledger = new Map();
  const add = (a: ID, b: ID, v: number) => {
    let row = ledger.get(a);
    if (!row) ledger.set(a, (row = new Map()));
    row.set(b, (row.get(b) ?? 0) + v);
  };
  for (const t of transfers) {
    add(t.to, t.from, t.amount);
    add(t.from, t.to, -t.amount);
  }
  return ledger;
}

/** Positive → b owes a. Negative → a owes b. */
export function balanceBetween(ledger: Ledger, a: ID, b: ID): number {
  return ledger.get(a)?.get(b) ?? 0;
}

/** Net debt for every pair that isn't settled, following who actually paid for whom. */
export function pairwiseTransfers(expenses: Expense[]): Transfer[] {
  const ledger = ledgerFromTransfers(expenses.flatMap(expenseTransfers));
  const out: Transfer[] = [];
  for (const [creditor, row] of ledger) {
    for (const [debtor, v] of row) if (v > 0) out.push({ from: debtor, to: creditor, amount: v });
  }
  return out.sort((x, y) => y.amount - x.amount);
}

/** Minimises the number of repayments: largest debtor pays largest creditor, repeat. */
export function simplifyDebts(net: Map<ID, number>): Transfer[] {
  const creditors = [...net].filter(([, v]) => v > 0).map(([id, v]) => ({ id, left: v }));
  const debtors = [...net].filter(([, v]) => v < 0).map(([id, v]) => ({ id, left: -v }));
  creditors.sort((a, b) => b.left - a.left);
  debtors.sort((a, b) => b.left - a.left);

  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    if (amount > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].left -= amount;
    creditors[j].left -= amount;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return out;
}

export function groupTransfers(group: Group, expenses: Expense[]): Transfer[] {
  const own = expenses.filter((e) => e.groupId === group.id);
  return group.simplifyDebts ? simplifyDebts(netBalances(own)) : pairwiseTransfers(own);
}

/** Every outstanding debt, tagged with the group it belongs to. This is the app's single source of balances. */
export function allTransfers(groups: Group[], expenses: Expense[]): ContextTransfer[] {
  const out: ContextTransfer[] = [];
  for (const g of groups) {
    for (const t of groupTransfers(g, expenses)) out.push({ ...t, groupId: g.id });
  }
  for (const t of pairwiseTransfers(expenses.filter((e) => e.groupId === null))) {
    out.push({ ...t, groupId: null });
  }
  return out;
}

export function paidBy(e: Expense, id: ID): number {
  return e.paidBy.find((s) => s.personId === id)?.amount ?? 0;
}

export function owedBy(e: Expense, id: ID): number {
  return e.owedBy.find((s) => s.personId === id)?.amount ?? 0;
}

export function involves(e: Expense, id: ID): boolean {
  return e.paidBy.some((s) => s.personId === id) || e.owedBy.some((s) => s.personId === id);
}

export function sortExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
