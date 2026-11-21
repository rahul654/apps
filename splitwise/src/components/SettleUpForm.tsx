import { useMemo, useState, type FormEvent } from 'react';
import { allTransfers, balanceBetween, ledgerFromTransfers } from '../lib/balances';
import { todayISO } from '../lib/date';
import { newId } from '../lib/id';
import { centsToInput, parseAmount } from '../lib/money';
import { useApp } from '../store/AppStore';
import { ME, type Expense, type ID } from '../types';
import { Modal } from './Modal';

interface Props {
  onClose: () => void;
  /** Existing payment to edit. */
  payment?: Expense;
  from?: ID;
  to?: ID;
  amount?: number;
  groupId?: ID | null;
}

export function SettleUpForm({ onClose, payment, ...defaults }: Props) {
  const { data, dispatch, fmt, nameOf } = useApp();

  const [from, setFrom] = useState<ID>(payment?.paidBy[0]?.personId ?? defaults.from ?? ME);
  const [to, setTo] = useState<ID>(payment?.owedBy[0]?.personId ?? defaults.to ?? '');
  const [groupId, setGroupId] = useState<string>(payment ? (payment.groupId ?? '') : (defaults.groupId ?? ''));
  const [amountStr, setAmountStr] = useState(
    payment ? centsToInput(payment.amount) : defaults.amount ? centsToInput(defaults.amount) : '',
  );
  const [date, setDate] = useState(payment?.date ?? todayISO());
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const [error, setError] = useState('');

  const group = data.groups.find((g) => g.id === groupId);
  const candidates: ID[] = group ? group.memberIds : data.people.map((p) => p.id);

  // Balance between the two people, ignoring the payment being edited.
  const owed = useMemo(() => {
    const expenses = payment ? data.expenses.filter((e) => e.id !== payment.id) : data.expenses;
    const transfers = allTransfers(data.groups, expenses).filter((t) => !groupId || t.groupId === groupId);
    return balanceBetween(ledgerFromTransfers(transfers), to, from); // > 0 → `from` owes `to`
  }, [data.expenses, data.groups, payment, groupId, from, to]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(amountStr) ?? 0;
    if (!from || !to) return setError('Choose who paid and who received the money.');
    if (from === to) return setError('The payer and the recipient must be different people.');
    if (!candidates.includes(from) || !candidates.includes(to)) return setError('Both people must be in the selected group.');
    if (amount <= 0) return setError('Enter an amount greater than zero.');

    const now = new Date().toISOString();
    const next: Expense = {
      id: payment?.id ?? newId(),
      kind: 'payment',
      description: 'Payment',
      amount,
      date,
      groupId: groupId || null,
      category: 'general',
      paidBy: [{ personId: from, amount }],
      owedBy: [{ personId: to, amount }],
      splitMethod: 'exact',
      splitInputs: {},
      notes: notes.trim(),
      createdAt: payment?.createdAt ?? now,
      updatedAt: now,
    };
    dispatch({ type: payment ? 'expense/update' : 'expense/add', expense: next });
    onClose();
  }

  const where = group ? ` in ${group.name}` : '';

  return (
    <Modal title={payment ? 'Edit payment' : 'Settle up'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Group</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">No group (overall balance)</option>
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>

          <div className="row-2 settle-row">
            <label className="field grow">
              <span>Paid by</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {candidates.map((id) => (
                  <option key={id} value={id}>{nameOf(id)}</option>
                ))}
              </select>
            </label>
            <span className="settle-arrow" aria-hidden="true">→</span>
            <label className="field grow">
              <span>Paid to</span>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {candidates
                  .filter((id) => id !== from)
                  .map((id) => (
                    <option key={id} value={id}>{nameOf(id)}</option>
                  ))}
              </select>
            </label>
          </div>

          {from && to && from !== to && (
            <p className="hint">
              {owed > 0 && (
                <>
                  {nameOf(from)} {from === ME ? 'owe' : 'owes'} {nameOf(to, true)} <strong>{fmt(owed)}</strong>
                  {where}.{' '}
                  <button type="button" className="link-btn" onClick={() => setAmountStr(centsToInput(owed))}>
                    Use this amount
                  </button>
                </>
              )}
              {owed < 0 && (
                <>
                  {nameOf(to)} {to === ME ? 'owe' : 'owes'} {nameOf(from, true)} <strong>{fmt(-owed)}</strong>
                  {where}.{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setFrom(to);
                      setTo(from);
                      setAmountStr(centsToInput(-owed));
                    }}
                  >
                    Switch direction
                  </button>
                </>
              )}
              {owed === 0 && <>{nameOf(from)} and {nameOf(to, true)} are settled up{where}.</>}
            </p>
          )}

          <div className="row-2">
            <label className="field grow">
              <span>Amount</span>
              <input
                autoFocus
                inputMode="decimal"
                className="amount-input"
                placeholder="0.00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} />
            </label>
          </div>

          <label className="field">
            <span>Notes (optional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. UPI transfer" />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save payment</button>
        </footer>
      </form>
    </Modal>
  );
}
