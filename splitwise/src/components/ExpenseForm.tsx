import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CATEGORIES, type CategoryId } from '../lib/categories';
import { todayISO } from '../lib/date';
import { newId } from '../lib/id';
import { centsToInput, parseAmount, parseNumber, sumShares } from '../lib/money';
import { computeSplit } from '../lib/split';
import { useApp } from '../store/AppStore';
import { ME, type Expense, type ID, type Person, type Share, type SplitMethod } from '../types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

const METHODS: { id: SplitMethod; label: string }[] = [
  { id: 'equal', label: 'Equally' },
  { id: 'exact', label: 'Exact amounts' },
  { id: 'percent', label: 'Percentages' },
  { id: 'shares', label: 'Shares' },
];

type InputMethod = Exclude<SplitMethod, 'equal'>;
type InputsByMethod = Record<InputMethod, Record<ID, string>>;

function initialInputs(expense?: Expense): InputsByMethod {
  const inputs: InputsByMethod = { exact: {}, percent: {}, shares: {} };
  if (expense && expense.splitMethod !== 'equal') {
    inputs[expense.splitMethod] = Object.fromEntries(
      Object.entries(expense.splitInputs).map(([id, v]) => [
        id,
        expense.splitMethod === 'exact' ? centsToInput(v) : String(v),
      ]),
    );
  }
  return inputs;
}

interface Props {
  onClose: () => void;
  expense?: Expense;
  defaultGroupId?: ID | null;
  defaultFriendId?: ID;
}

export function ExpenseForm({ onClose, expense, defaultGroupId = null, defaultFriendId }: Props) {
  const { data, dispatch, fmt, nameOf, person } = useApp();
  const friends = data.people.filter((p) => p.id !== ME);

  const [groupId, setGroupId] = useState<string>(expense ? (expense.groupId ?? '') : (defaultGroupId ?? ''));
  const [friendIds, setFriendIds] = useState<ID[]>(() => {
    if (expense && !expense.groupId) {
      const ids = [...expense.paidBy, ...expense.owedBy].map((s) => s.personId).concat(Object.keys(expense.splitInputs));
      return [...new Set(ids)].filter((id) => id !== ME);
    }
    return defaultFriendId ? [defaultFriendId] : [];
  });
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amountStr, setAmountStr] = useState(expense ? centsToInput(expense.amount) : '');
  const [category, setCategory] = useState<CategoryId>(expense?.category ?? 'general');
  const [date, setDate] = useState(expense?.date ?? todayISO());
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [payer, setPayer] = useState<ID>(() =>
    expense ? (expense.paidBy.length === 1 ? expense.paidBy[0].personId : 'multiple') : ME,
  );
  const [payerInputs, setPayerInputs] = useState<Record<ID, string>>(() =>
    expense && expense.paidBy.length > 1
      ? Object.fromEntries(expense.paidBy.map((s) => [s.personId, centsToInput(s.amount)]))
      : {},
  );
  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? 'equal');
  const [inputs, setInputs] = useState<InputsByMethod>(() => initialInputs(expense));
  const [excluded, setExcluded] = useState<Set<ID>>(
    () =>
      new Set(
        expense?.splitMethod === 'equal'
          ? Object.entries(expense.splitInputs).filter(([, v]) => v === 0).map(([id]) => id)
          : [],
      ),
  );
  const [newFriendName, setNewFriendName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const group = data.groups.find((g) => g.id === groupId);
  const participants: ID[] = group ? group.memberIds : [ME, ...friendIds];
  const multiplePayers = payer === 'multiple';
  const singlePayer = participants.includes(payer) ? payer : (participants[0] ?? ME);

  // --- derived amounts -------------------------------------------------------
  const total = parseAmount(amountStr) ?? 0;

  const numericInputs: Record<ID, number> = {};
  for (const id of participants) {
    if (method === 'equal') numericInputs[id] = excluded.has(id) ? 0 : 1;
    else if (method === 'exact') numericInputs[id] = parseAmount(inputs.exact[id] ?? '') ?? 0;
    else numericInputs[id] = parseNumber(inputs[method][id]);
  }
  const split = computeSplit(method, total, participants, numericInputs);
  const shareOf = new Map(split.ok ? split.shares.map((s) => [s.personId, s.amount]) : []);

  const paidBy: Share[] = multiplePayers
    ? participants
        .map((personId) => ({ personId, amount: parseAmount(payerInputs[personId] ?? '') ?? 0 }))
        .filter((s) => s.amount > 0)
    : [{ personId: singlePayer, amount: total }];
  const paidSum = sumShares(paidBy);

  const problem = (() => {
    if (!description.trim()) return 'Enter a description.';
    if (total <= 0) return 'Enter an amount greater than zero.';
    if (participants.length < 2) return group ? 'This group needs at least two members.' : 'Choose at least one friend to split with.';
    if (paidSum !== total) return `The payers add up to ${fmt(paidSum)}, but the total is ${fmt(total)}.`;
    if (!split.ok) return split.error;
    return null;
  })();

  // --- status line under the split rows ---------------------------------------
  let splitStatus = '';
  if (method === 'equal') {
    const n = participants.length - participants.filter((id) => excluded.has(id)).length;
    splitStatus = n > 0 && total > 0 ? `${fmt(Math.floor(total / n))} per person · ${n} people` : '';
  } else if (method === 'exact') {
    const assigned = participants.reduce((s, id) => s + numericInputs[id], 0);
    const left = total - assigned;
    splitStatus = `${fmt(assigned)} of ${fmt(total)} · ${left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over`}`;
  } else if (method === 'percent') {
    const pct = participants.reduce((s, id) => s + numericInputs[id], 0);
    const left = Math.round((100 - pct) * 100) / 100;
    splitStatus = `${Math.round(pct * 100) / 100}% of 100% · ${left >= 0 ? `${left}% left` : `${-left}% over`}`;
  } else {
    const shares = participants.reduce((s, id) => s + numericInputs[id], 0);
    splitStatus = `${shares} total share${shares === 1 ? '' : 's'}`;
  }

  // --- handlers ---------------------------------------------------------------
  function changeMethod(next: SplitMethod) {
    if (next === 'shares' && participants.every((id) => !inputs.shares[id])) {
      setInputs((prev) => ({ ...prev, shares: Object.fromEntries(participants.map((id) => [id, '1'])) }));
    }
    setMethod(next);
  }

  function setInput(id: ID, value: string) {
    if (method === 'equal') return;
    setInputs((prev) => ({ ...prev, [method]: { ...prev[method], [id]: value } }));
  }

  function toggleFriend(id: ID) {
    setFriendIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function addFriendInline() {
    const name = newFriendName.trim();
    if (!name) return;
    const existing = data.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.id !== ME && !friendIds.includes(existing.id)) setFriendIds((prev) => [...prev, existing.id]);
    } else {
      const p: Person = { id: newId(), name, email: '', createdAt: new Date().toISOString() };
      dispatch({ type: 'person/add', person: p });
      setFriendIds((prev) => [...prev, p.id]);
    }
    setNewFriendName('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setAttempt((n) => n + 1);
    if (problem || !split.ok) return;
    const now = new Date().toISOString();
    const next: Expense = {
      id: expense?.id ?? newId(),
      kind: 'expense',
      description: description.trim(),
      amount: total,
      date,
      groupId: groupId || null,
      category,
      paidBy,
      owedBy: split.shares,
      splitMethod: method,
      splitInputs: numericInputs,
      notes: notes.trim(),
      createdAt: expense?.createdAt ?? now,
      updatedAt: now,
    };
    dispatch({ type: expense ? 'expense/update' : 'expense/add', expense: next });
    onClose();
  }

  // The error sits at the bottom of a long form; bring it into view on each failed save.
  useEffect(() => {
    if (attempt) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [attempt]);

  const suffix = method === 'percent' ? '%' : method === 'shares' ? 'share(s)' : '';

  return (
    <Modal title={expense ? 'Edit expense' : 'Add an expense'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Group</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">No group — just friends</option>
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>

          {!group && (
            <div className="field">
              <span>With you and</span>
              <div className="chips">
                {friends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`chip ${friendIds.includes(f.id) ? 'active' : ''}`}
                    onClick={() => toggleFriend(f.id)}
                    aria-pressed={friendIds.includes(f.id)}
                  >
                    <Avatar person={f} size={20} /> {f.name}
                  </button>
                ))}
              </div>
              <div className="inline-add">
                <input
                  value={newFriendName}
                  onChange={(e) => setNewFriendName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addFriendInline();
                    }
                  }}
                  placeholder={friends.length ? 'Or add someone new' : 'Add a friend by name'}
                />
                <button type="button" className="btn" onClick={addFriendInline}>Add</button>
              </div>
            </div>
          )}

          <div className="row-2">
            <label className="field grow">
              <span>Description</span>
              <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Dinner" />
            </label>
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as CategoryId)}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="row-2">
            <label className="field grow">
              <span>Amount</span>
              <input
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="amount-input"
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} />
            </label>
          </div>

          <div className="field">
            <span>Paid by</span>
            <select
              aria-label="Paid by"
              value={multiplePayers ? 'multiple' : singlePayer}
              onChange={(e) => setPayer(e.target.value)}
            >
              {participants.map((id) => (
                <option key={id} value={id}>{nameOf(id)}</option>
              ))}
              <option value="multiple">Multiple people</option>
            </select>
            {multiplePayers && (
              <>
                <ul className="split-rows">
                  {participants.map((id) => (
                    <li key={id}>
                      <Avatar person={person(id)} size={26} />
                      <span className="grow">{nameOf(id)}</span>
                      <input
                        className="small-input"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={payerInputs[id] ?? ''}
                        onChange={(e) => setPayerInputs((prev) => ({ ...prev, [id]: e.target.value }))}
                      />
                    </li>
                  ))}
                </ul>
                <p className="split-status">
                  {fmt(paidSum)} of {fmt(total)} ·{' '}
                  {total - paidSum >= 0 ? `${fmt(total - paidSum)} left` : `${fmt(paidSum - total)} over`}
                </p>
              </>
            )}
          </div>

          <div className="field">
            <span>Split</span>
            <div className="segmented">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={m.id === method ? 'active' : ''}
                  onClick={() => changeMethod(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <ul className="split-rows">
              {participants.map((id) => (
                <li key={id}>
                  {method === 'equal' && (
                    <input
                      type="checkbox"
                      checked={!excluded.has(id)}
                      aria-label={`Include ${nameOf(id)}`}
                      onChange={() =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    />
                  )}
                  <Avatar person={person(id)} size={26} />
                  <span className="grow">{nameOf(id)}</span>
                  {method !== 'equal' && (
                    <span className="input-suffix">
                      <input
                        className="small-input"
                        inputMode="decimal"
                        placeholder="0"
                        value={inputs[method][id] ?? ''}
                        onChange={(e) => setInput(id, e.target.value)}
                        aria-label={`${nameOf(id)} ${method}`}
                      />
                      {suffix && <small>{suffix}</small>}
                    </span>
                  )}
                  <span className="share-amount">{shareOf.has(id) ? fmt(shareOf.get(id)!) : '—'}</span>
                </li>
              ))}
            </ul>
            {splitStatus && <p className="split-status">{splitStatus}</p>}
          </div>

          <label className="field">
            <span>Notes (optional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {submitted && problem && (
            <p ref={errorRef} className="form-error" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </footer>
      </form>
    </Modal>
  );
}
