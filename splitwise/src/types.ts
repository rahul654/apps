import type { CategoryId } from './lib/categories';

export type ID = string;

/** The person using the app. Always present in `AppData.people`. */
export const ME: ID = 'me';

export interface Person {
  id: ID;
  name: string;
  email: string;
  createdAt: string;
}

export type GroupType = 'home' | 'trip' | 'couple' | 'other';

export interface Group {
  id: ID;
  name: string;
  type: GroupType;
  memberIds: ID[];
  /** When on, suggested repayments are minimised instead of following who-paid-for-whom. */
  simplifyDebts: boolean;
  createdAt: string;
}

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

/** An amount attributed to one person. All money is stored as integer minor units (paise/cents). */
export interface Share {
  personId: ID;
  amount: number;
}

/**
 * Both expenses and settle-up payments are stored as `Expense`.
 * A payment from A to B is `paidBy: [A]`, `owedBy: [B]`, which moves the balance the right way.
 */
export interface Expense {
  id: ID;
  kind: 'expense' | 'payment';
  description: string;
  amount: number;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  groupId: ID | null;
  category: CategoryId;
  paidBy: Share[];
  owedBy: Share[];
  splitMethod: SplitMethod;
  /** Raw per-person split input, kept so the form can be re-opened for editing.
   *  equal: 1 included / 0 excluded · exact: minor units · percent: % · shares: share count */
  splitInputs: Record<ID, number>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEntry {
  id: ID;
  at: string;
  message: string;
  groupId: ID | null;
  expenseId: ID | null;
}

export interface Settings {
  currency: string;
}

export interface AppData {
  version: 1;
  people: Person[];
  groups: Group[];
  expenses: Expense[];
  activity: ActivityEntry[];
  settings: Settings;
}

/** `from` owes `to` `amount`. */
export interface Transfer {
  from: ID;
  to: ID;
  amount: number;
}
