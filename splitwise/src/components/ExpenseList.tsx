import { useState } from 'react';
import { Link } from 'react-router-dom';
import { owedBy, paidBy, sortExpenses } from '../lib/balances';
import { categoryOf } from '../lib/categories';
import { dateParts, formatDate, monthLabel, timeAgo } from '../lib/date';
import { useApp } from '../store/AppStore';
import { ME, type Expense } from '../types';
import { ExpenseForm } from './ExpenseForm';
import { EmptyState } from './PageHeader';
import { SettleUpForm } from './SettleUpForm';

export function ExpenseList({ expenses, showGroup = true }: { expenses: Expense[]; showGroup?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);

  if (expenses.length === 0) {
    return (
      <EmptyState icon="🧾" title="No expenses yet">
        <p className="muted">Add an expense and it will show up here.</p>
      </EmptyState>
    );
  }

  const sorted = sortExpenses(expenses);
  const months: { label: string; items: Expense[] }[] = [];
  for (const e of sorted) {
    const label = monthLabel(e.date);
    if (months.at(-1)?.label !== label) months.push({ label, items: [] });
    months.at(-1)!.items.push(e);
  }

  return (
    <>
      {months.map((m) => (
        <section key={m.label} className="month">
          <h3 className="month-label">{m.label}</h3>
          <ul className="expense-list">
            {m.items.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                showGroup={showGroup}
                open={openId === e.id}
                onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                onEdit={() => setEditing(e)}
              />
            ))}
          </ul>
        </section>
      ))}
      {editing?.kind === 'expense' && <ExpenseForm expense={editing} onClose={() => setEditing(null)} />}
      {editing?.kind === 'payment' && <SettleUpForm payment={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ExpenseRow({
  expense: e,
  showGroup,
  open,
  onToggle,
  onEdit,
}: {
  expense: Expense;
  showGroup: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { data, dispatch, fmt, nameOf } = useApp();
  const { month, day } = dateParts(e.date);
  const group = e.groupId ? data.groups.find((g) => g.id === e.groupId) : undefined;
  const isPayment = e.kind === 'payment';
  const cat = categoryOf(e.category);

  const payerText =
    e.paidBy.length === 1
      ? `${nameOf(e.paidBy[0].personId)} paid ${fmt(e.amount)}`
      : `${e.paidBy.length} people paid ${fmt(e.amount)}`;

  // How this expense moves *my* balance.
  const lent = paidBy(e, ME) - owedBy(e, ME);
  const meInvolved = e.paidBy.some((s) => s.personId === ME) || e.owedBy.some((s) => s.personId === ME);

  let right;
  if (isPayment) {
    const from = e.paidBy[0]?.personId;
    const to = e.owedBy[0]?.personId;
    right =
      from === ME ? (
        <div className="neutral"><small>you paid</small>{fmt(e.amount)}</div>
      ) : to === ME ? (
        <div className="neutral"><small>you received</small>{fmt(e.amount)}</div>
      ) : (
        <div className="muted"><small>not involved</small></div>
      );
  } else if (!meInvolved) {
    right = <div className="muted"><small>not involved</small></div>;
  } else if (lent > 0) {
    right = <div className="lent"><small>you lent</small>{fmt(lent)}</div>;
  } else if (lent < 0) {
    right = <div className="borrowed"><small>you borrowed</small>{fmt(-lent)}</div>;
  } else {
    right = <div className="muted"><small>no balance</small></div>;
  }

  function remove() {
    const what = isPayment ? 'this payment' : `"${e.description}"`;
    if (window.confirm(`Delete ${what}? This can't be undone.`)) dispatch({ type: 'expense/delete', id: e.id });
  }

  return (
    <li className={`expense ${isPayment ? 'payment' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="expense-summary" onClick={onToggle} aria-expanded={open}>
        <span className="date-box">
          <small>{month}</small>
          {day}
        </span>
        <span className="cat-icon" aria-hidden="true">{isPayment ? '💸' : cat.icon}</span>
        <span className="expense-main">
          <strong>
            {isPayment
              ? `${nameOf(e.paidBy[0]?.personId ?? '')} paid ${nameOf(e.owedBy[0]?.personId ?? '', true)}`
              : e.description}
          </strong>
          <small className="muted">
            {isPayment ? fmt(e.amount) : payerText}
            {showGroup && group && <span className="tag">{group.name}</span>}
          </small>
        </span>
        <span className="expense-right">{right}</span>
      </button>

      {open && (
        <div className="expense-details">
          {!isPayment && (
            <ul className="detail-lines">
              {[...new Set([...e.paidBy, ...e.owedBy].map((s) => s.personId))].map((id) => {
                const p = paidBy(e, id);
                const o = owedBy(e, id);
                const owe = id === ME ? 'owe' : 'owes';
                return (
                  <li key={id}>
                    <strong>{nameOf(id)}</strong>{' '}
                    {p > 0 && o > 0 && <>paid {fmt(p)} and {owe} {fmt(o)}</>}
                    {p > 0 && o === 0 && <>paid {fmt(p)}</>}
                    {p === 0 && <>{owe} {fmt(o)}</>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small">
            {!isPayment && e.category !== 'general' && <>{cat.label} · </>}
            {formatDate(e.date)} · added {timeAgo(e.createdAt)}
            {e.updatedAt !== e.createdAt && <> · edited {timeAgo(e.updatedAt)}</>}
            {group && (
              <>
                {' '}· <Link to={`/groups/${group.id}`}>{group.name}</Link>
              </>
            )}
          </p>
          {e.notes && <p className="notes">{e.notes}</p>}
          <div className="detail-actions">
            <button type="button" className="btn btn-small" onClick={onEdit}>Edit</button>
            <button type="button" className="btn btn-small btn-danger" onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </li>
  );
}
