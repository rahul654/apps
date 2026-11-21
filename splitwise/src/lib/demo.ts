import { ME, type AppData, type Expense, type Group, type ID, type Person } from '../types';
import type { CategoryId } from './categories';
import { todayISO } from './date';
import { newId } from './id';
import { splitEqually } from './split';
import { emptyData } from './storage';

/** Sample friends, groups and expenses so the app can be explored without typing everything in. */
export function demoData(currency: string): AppData {
  const now = new Date().toISOString();
  const person = (name: string): Person => ({ id: newId(), name, email: '', createdAt: now });
  const [aarav, priya, rohan, meera] = ['Aarav', 'Priya', 'Rohan', 'Meera'].map(person);

  const group = (name: string, type: Group['type'], memberIds: ID[]): Group => ({
    id: newId(), name, type, memberIds, simplifyDebts: true, createdAt: now,
  });
  const goa = group('Goa trip', 'trip', [ME, aarav.id, priya.id, rohan.id]);
  const flat = group('Flat 302', 'home', [ME, meera.id, rohan.id]);

  const expense = (
    description: string, rupees: number, payer: ID, among: ID[],
    groupId: ID | null, category: CategoryId, daysAgo: number,
  ): Expense => {
    const amount = rupees * 100;
    return {
      id: newId(), kind: 'expense', description, amount, date: todayISO(-daysAgo), groupId, category,
      paidBy: [{ personId: payer, amount }],
      owedBy: splitEqually(amount, among),
      splitMethod: 'equal',
      splitInputs: Object.fromEntries(among.map((id) => [id, 1])),
      notes: '', createdAt: now, updatedAt: now,
    };
  };

  const expenses: Expense[] = [
    expense('Villa booking', 24000, ME, goa.memberIds, goa.id, 'travel', 20),
    expense('Scooter rental', 3200, aarav.id, goa.memberIds, goa.id, 'transport', 19),
    expense('Seafood dinner', 5400, priya.id, goa.memberIds, goa.id, 'food', 18),
    expense('Rent – this month', 45000, meera.id, flat.memberIds, flat.id, 'rent', 10),
    expense('Electricity bill', 2850, ME, flat.memberIds, flat.id, 'utilities', 6),
    expense('Groceries', 1980, rohan.id, flat.memberIds, flat.id, 'groceries', 3),
    expense('Movie night', 1100, ME, [ME, priya.id], null, 'entertainment', 2),
    {
      id: newId(), kind: 'payment', description: 'Payment', amount: 300000, date: todayISO(-15), groupId: goa.id,
      category: 'general', paidBy: [{ personId: rohan.id, amount: 300000 }], owedBy: [{ personId: ME, amount: 300000 }],
      splitMethod: 'exact', splitInputs: {}, notes: '', createdAt: now, updatedAt: now,
    },
  ];

  const base = emptyData();
  return {
    ...base,
    people: [...base.people, aarav, priya, rohan, meera],
    groups: [goa, flat],
    expenses,
    activity: [{ id: newId(), at: now, message: 'You loaded the demo data.', groupId: null, expenseId: null }],
    settings: { currency },
  };
}
