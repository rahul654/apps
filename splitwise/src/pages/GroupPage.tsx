import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ExpenseForm } from '../components/ExpenseForm';
import { ExpenseList } from '../components/ExpenseList';
import { GroupForm } from '../components/GroupForm';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { SettleUpForm } from '../components/SettleUpForm';
import { netBalances, owedBy, paidBy } from '../lib/balances';
import { groupTypeOf } from '../lib/categories';
import { useApp } from '../store/AppStore';
import { ME, type Transfer } from '../types';

export function GroupPage() {
  const { groupId } = useParams();
  const { data, dispatch, transfers, fmt, nameOf, person } = useApp();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | 'expense' | 'edit'>(null);
  const [settle, setSettle] = useState<Partial<Transfer> | null>(null);

  const group = data.groups.find((g) => g.id === groupId);
  if (!group) {
    return <EmptyState icon="🤷" title="Group not found"><p className="muted">It may have been deleted.</p></EmptyState>;
  }

  const expenses = data.expenses.filter((e) => e.groupId === group.id);
  const net = netBalances(expenses);
  const repayments = transfers.filter((t) => t.groupId === group.id);
  const spending = expenses.filter((e) => e.kind === 'expense');
  const totalSpent = spending.reduce((s, e) => s + e.amount, 0);
  const myShare = spending.reduce((s, e) => s + owedBy(e, ME), 0);
  const myPaid = spending.reduce((s, e) => s + paidBy(e, ME), 0);

  function remove() {
    if (!group) return;
    const msg = expenses.length
      ? `Delete "${group.name}" and its ${expenses.length} expense(s)? This can't be undone.`
      : `Delete "${group.name}"?`;
    if (window.confirm(msg)) {
      dispatch({ type: 'group/delete', id: group.id });
      navigate('/');
    }
  }

  return (
    <>
      <PageHeader
        icon={groupTypeOf(group.type).icon}
        title={group.name}
        subtitle={`${group.memberIds.length} members`}
        actions={
          <>
            <button type="button" className="btn btn-accent" onClick={() => setModal('expense')}>Add an expense</button>
            <button type="button" className="btn btn-primary" onClick={() => setSettle({})}>Settle up</button>
          </>
        }
      />

      <div className="with-aside">
        <div className="content">
          <ExpenseList expenses={expenses} showGroup={false} />
        </div>

        <aside className="aside">
          <section className="card">
            <h3>Group balances</h3>
            <ul className="balance-list">
              {group.memberIds.map((id) => {
                const v = net.get(id) ?? 0;
                return (
                  <li key={id}>
                    <Avatar person={person(id)} size={28} />
                    <span className="grow">
                      <strong>{nameOf(id)}</strong>
                      {v > 0 && <small className="lent">{id === ME ? 'get back' : 'gets back'} {fmt(v)}</small>}
                      {v < 0 && <small className="borrowed">{id === ME ? 'owe' : 'owes'} {fmt(-v)}</small>}
                      {v === 0 && <small className="muted">settled up</small>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <h3>Suggested repayments</h3>
            {repayments.length === 0 ? (
              <p className="muted small">Everyone is settled up. 🎉</p>
            ) : (
              <ul className="repay-list">
                {repayments.map((t) => (
                  <li key={`${t.from}-${t.to}`}>
                    <span className="grow">
                      <strong>{nameOf(t.from)}</strong> {t.from === ME ? 'owe' : 'owes'} <strong>{nameOf(t.to, true)}</strong>
                      <br />
                      <span className={t.to === ME ? 'lent' : t.from === ME ? 'borrowed' : 'neutral'}>{fmt(t.amount)}</span>
                    </span>
                    <button type="button" className="btn btn-small" onClick={() => setSettle(t)}>Settle</button>
                  </li>
                ))}
              </ul>
            )}
            <label className="toggle compact">
              <input
                type="checkbox"
                checked={group.simplifyDebts}
                onChange={(e) =>
                  dispatch({ type: 'group/update', group: { ...group, simplifyDebts: e.target.checked }, newPeople: [] })
                }
              />
              <span>Simplify debts</span>
            </label>
          </section>

          <section className="card">
            <h3>Totals</h3>
            <dl className="totals">
              <dt>Group spending</dt>
              <dd>{fmt(totalSpent)}</dd>
              <dt>You paid</dt>
              <dd>{fmt(myPaid)}</dd>
              <dt>Your share</dt>
              <dd>{fmt(myShare)}</dd>
            </dl>
          </section>

          <div className="aside-actions">
            <button type="button" className="btn btn-small" onClick={() => setModal('edit')}>Edit group</button>
            <button type="button" className="btn btn-small btn-danger" onClick={remove}>Delete group</button>
          </div>
        </aside>
      </div>

      {modal === 'expense' && <ExpenseForm defaultGroupId={group.id} onClose={() => setModal(null)} />}
      {modal === 'edit' && <GroupForm group={group} onClose={() => setModal(null)} />}
      {settle && (
        <SettleUpForm
          groupId={group.id}
          from={settle.from ?? repayments.find((t) => t.from === ME)?.from ?? ME}
          to={settle.to ?? repayments.find((t) => t.from === ME)?.to ?? group.memberIds.find((id) => id !== ME)}
          amount={settle.amount ?? repayments.find((t) => t.from === ME)?.amount}
          onClose={() => setSettle(null)}
        />
      )}
    </>
  );
}
