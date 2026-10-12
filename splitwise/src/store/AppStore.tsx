import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { allTransfers, ledgerFromTransfers, type ContextTransfer, type Ledger } from '../lib/balances';
import { newId } from '../lib/id';
import { formatMoney } from '../lib/money';
import { STORAGE_KEY, loadData, parseData, saveData } from '../lib/storage';
import { ME, type AppData, type Expense, type Group, type ID, type Person, type Settings } from '../types';

export type Action =
  | { type: 'person/add'; person: Person }
  | { type: 'person/update'; id: ID; name: string; email: string }
  | { type: 'person/delete'; id: ID }
  | { type: 'group/add'; group: Group; newPeople: Person[] }
  | { type: 'group/update'; group: Group; newPeople: Person[] }
  | { type: 'group/delete'; id: ID }
  | { type: 'expense/add'; expense: Expense }
  | { type: 'expense/update'; expense: Expense }
  | { type: 'expense/delete'; id: ID }
  | { type: 'settings/update'; settings: Partial<Settings> }
  | { type: 'data/replace'; data: AppData; message: string }
  | { type: 'data/sync'; data: AppData };

const MAX_ACTIVITY = 500;

function reducer(state: AppData, action: Action): AppData {
  const nameOf = (id: ID, subject: boolean) =>
    id === ME ? (subject ? 'You' : 'you') : (state.people.find((p) => p.id === id)?.name ?? 'someone');
  const money = (cents: number) => formatMoney(cents, state.settings.currency);
  const log = (next: AppData, message: string, groupId: ID | null = null, expenseId: ID | null = null): AppData => ({
    ...next,
    activity: [{ id: newId(), at: new Date().toISOString(), message, groupId, expenseId }, ...next.activity].slice(
      0,
      MAX_ACTIVITY,
    ),
  });
  const describe = (e: Expense) =>
    e.kind === 'payment'
      ? `${nameOf(e.paidBy[0]?.personId ?? '', true)} paid ${nameOf(e.owedBy[0]?.personId ?? '', false)} ${money(e.amount)}`
      : `"${e.description}" (${money(e.amount)})`;

  switch (action.type) {
    case 'person/add':
      return log({ ...state, people: [...state.people, action.person] }, `You added ${action.person.name} as a friend.`);

    case 'person/update': {
      const people = state.people.map((p) =>
        p.id === action.id ? { ...p, name: action.name, email: action.email } : p,
      );
      const msg = action.id === ME ? 'You updated your profile.' : `You updated ${action.name}'s details.`;
      return log({ ...state, people }, msg);
    }

    case 'person/delete':
      return log(
        {
          ...state,
          people: state.people.filter((p) => p.id !== action.id),
          groups: state.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== action.id) })),
        },
        `You removed ${nameOf(action.id, true)} from your friends.`,
      );

    case 'group/add':
      return log(
        { ...state, people: [...state.people, ...action.newPeople], groups: [...state.groups, action.group] },
        `You created the group "${action.group.name}".`,
        action.group.id,
      );

    case 'group/update':
      return log(
        {
          ...state,
          people: [...state.people, ...action.newPeople],
          groups: state.groups.map((g) => (g.id === action.group.id ? action.group : g)),
        },
        `You updated the group "${action.group.name}".`,
        action.group.id,
      );

    case 'group/delete': {
      const group = state.groups.find((g) => g.id === action.id);
      return log(
        {
          ...state,
          groups: state.groups.filter((g) => g.id !== action.id),
          expenses: state.expenses.filter((e) => e.groupId !== action.id),
        },
        `You deleted the group "${group?.name ?? ''}" and its expenses.`,
      );
    }

    case 'expense/add': {
      const e = action.expense;
      const msg = e.kind === 'payment' ? `${describe(e)}.` : `You added ${describe(e)}.`;
      return log({ ...state, expenses: [...state.expenses, e] }, msg, e.groupId, e.id);
    }

    case 'expense/update': {
      const e = action.expense;
      return log(
        { ...state, expenses: state.expenses.map((x) => (x.id === e.id ? e : x)) },
        e.kind === 'payment' ? `You updated a payment: ${describe(e)}.` : `You updated ${describe(e)}.`,
        e.groupId,
        e.id,
      );
    }

    case 'expense/delete': {
      const e = state.expenses.find((x) => x.id === action.id);
      if (!e) return state;
      return log(
        { ...state, expenses: state.expenses.filter((x) => x.id !== action.id) },
        e.kind === 'payment' ? `You deleted a payment: ${describe(e)}.` : `You deleted ${describe(e)}.`,
        e.groupId,
      );
    }

    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.settings } };

    case 'data/replace':
      return log(action.data, action.message);

    case 'data/sync':
      return action.data;
  }
}

interface AppContextValue {
  data: AppData;
  dispatch: (action: Action) => void;
  /** Every outstanding debt, per group (or null for non-group). */
  transfers: ContextTransfer[];
  /** Overall balances across all groups. */
  ledger: Ledger;
  person: (id: ID) => Person | undefined;
  /** "You" for the current user (or "you" when `asObject`), otherwise the person's name. */
  nameOf: (id: ID, asObject?: boolean) => string;
  fmt: (cents: number) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, loadData);

  useEffect(() => saveData(data), [data]);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const next = parseData(e.newValue);
      if (next) dispatch({ type: 'data/sync', data: next });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const transfers = useMemo(() => allTransfers(data.groups, data.expenses), [data.groups, data.expenses]);
  const ledger = useMemo(() => ledgerFromTransfers(transfers), [transfers]);
  const person = useCallback((id: ID) => data.people.find((p) => p.id === id), [data.people]);
  const nameOf = useCallback(
    (id: ID, asObject = false) =>
      id === ME ? (asObject ? 'you' : 'You') : (data.people.find((p) => p.id === id)?.name ?? 'Unknown'),
    [data.people],
  );
  const fmt = useCallback((cents: number) => formatMoney(cents, data.settings.currency), [data.settings.currency]);

  const value = useMemo(
    () => ({ data, dispatch, transfers, ledger, person, nameOf, fmt }),
    [data, transfers, ledger, person, nameOf, fmt],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
