import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ExpenseForm } from '../components/ExpenseForm';
import { ExpenseList } from '../components/ExpenseList';
import { FriendForm } from '../components/FriendForm';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { SettleUpForm } from '../components/SettleUpForm';
import { balanceBetween, involves, ledgerFromTransfers } from '../lib/balances';
import { useApp } from '../store/AppStore';
import { ME, type ID } from '../types';

export function FriendPage() {
  const { friendId } = useParams();
  const { data, dispatch, transfers, ledger, fmt } = useApp();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | 'expense' | 'edit'>(null);
  const [settle, setSettle] = useState<{ groupId: ID | null; bal: number } | null>(null);

  const friend = data.people.find((p) => p.id === friendId && p.id !== ME);
  if (!friend) {
    return <EmptyState icon="🤷" title="Friend not found"><p className="muted">They may have been removed.</p></EmptyState>;
  }

  const overall = balanceBetween(ledger, ME, friend.id); // > 0 → they owe me
  const shared = data.expenses.filter((e) => involves(e, ME) && involves(e, friend.id));

  // Per-group breakdown of the overall balance.
  const contexts = [...data.groups.map((g) => ({ id: g.id as ID | null, name: g.name })), { id: null, name: 'Non-group expenses' }]
    .map((c) => ({
      ...c,
      bal: balanceBetween(
        ledgerFromTransfers(transfers.filter((t) => t.groupId === c.id)),
        ME,
        friend.id,
      ),
    }))
    .filter((c) => c.bal !== 0);

  const anyHistory = data.expenses.some((e) => involves(e, friend.id));

  function remove() {
    if (!friend) return;
    if (anyHistory) {
      window.alert(`${friend.name} has expenses recorded. Delete those expenses first, then remove them.`);
      return;
    }
    if (window.confirm(`Remove ${friend.name}? They will also be removed from any groups.`)) {
      dispatch({ type: 'person/delete', id: friend.id });
      navigate('/');
    }
  }

  return (
    <>
      <PageHeader
        icon={<Avatar person={friend} size={44} />}
        title={friend.name}
        subtitle={
          overall > 0 ? (
            <span className="lent">owes you {fmt(overall)}</span>
          ) : overall < 0 ? (
            <span className="borrowed">you owe {fmt(-overall)}</span>
          ) : (
            <span className="muted">all settled up</span>
          )
        }
        actions={
          <>
            <button type="button" className="btn btn-accent" onClick={() => setModal('expense')}>Add an expense</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                setSettle(
                  contexts.length === 1
                    ? { groupId: contexts[0].id, bal: contexts[0].bal }
                    : { groupId: null, bal: overall },
                )
              }
            >
              Settle up
            </button>
          </>
        }
      />

      <div className="with-aside">
        <div className="content">
          <ExpenseList expenses={shared} />
        </div>
        <aside className="aside">
          <section className="card">
            <h3>Balance breakdown</h3>
            {contexts.length === 0 ? (
              <p className="muted small">You and {friend.name} are all settled up.</p>
            ) : (
              <ul className="repay-list">
                {contexts.map((c) => (
                  <li key={c.id ?? 'none'}>
                    <span className="grow">
                      <small className="muted">{c.name}</small>
                      <br />
                      {c.bal > 0 ? (
                        <span className="lent">{friend.name} owes you {fmt(c.bal)}</span>
                      ) : (
                        <span className="borrowed">you owe {fmt(-c.bal)}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setSettle({ groupId: c.id, bal: c.bal })}
                    >
                      Settle
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {friend.email && (
            <section className="card">
              <h3>Contact</h3>
              <p className="small"><a href={`mailto:${friend.email}`}>{friend.email}</a></p>
            </section>
          )}
          <div className="aside-actions">
            <button type="button" className="btn btn-small" onClick={() => setModal('edit')}>Edit friend</button>
            <button type="button" className="btn btn-small btn-danger" onClick={remove}>Remove friend</button>
          </div>
        </aside>
      </div>

      {modal === 'expense' && <ExpenseForm defaultFriendId={friend.id} onClose={() => setModal(null)} />}
      {modal === 'edit' && <FriendForm friend={friend} onClose={() => setModal(null)} />}
      {settle && (
        <SettleUpForm
          groupId={settle.groupId}
          from={settle.bal > 0 ? friend.id : ME}
          to={settle.bal > 0 ? ME : friend.id}
          amount={settle.bal !== 0 ? Math.abs(settle.bal) : undefined}
          onClose={() => setSettle(null)}
        />
      )}
    </>
  );
}
