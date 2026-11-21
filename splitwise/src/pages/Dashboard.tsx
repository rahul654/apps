import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ExpenseForm } from '../components/ExpenseForm';
import { FriendForm } from '../components/FriendForm';
import { GroupForm } from '../components/GroupForm';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { SettleUpForm } from '../components/SettleUpForm';
import { balanceBetween } from '../lib/balances';
import { demoData } from '../lib/demo';
import { useApp } from '../store/AppStore';
import { ME } from '../types';

export function Dashboard() {
  const { data, dispatch, ledger, fmt } = useApp();
  const [modal, setModal] = useState<null | 'expense' | 'settle' | 'friend' | 'group'>(null);

  const friends = data.people.filter((p) => p.id !== ME);
  const rows = friends.map((f) => ({ friend: f, bal: balanceBetween(ledger, ME, f.id) }));
  const owedToMe = rows.filter((r) => r.bal > 0).sort((a, b) => b.bal - a.bal);
  const iOwe = rows.filter((r) => r.bal < 0).sort((a, b) => a.bal - b.bal);
  const totalOwed = owedToMe.reduce((s, r) => s + r.bal, 0);
  const totalOwe = iOwe.reduce((s, r) => s - r.bal, 0);
  const net = totalOwed - totalOwe;

  const isEmpty = friends.length === 0 && data.groups.length === 0 && data.expenses.length === 0;

  const actions = (
    <>
      <button type="button" className="btn btn-accent" onClick={() => setModal('expense')}>Add an expense</button>
      <button type="button" className="btn btn-primary" onClick={() => setModal('settle')}>Settle up</button>
    </>
  );

  return (
    <>
      <PageHeader title="Dashboard" actions={!isEmpty && actions} />

      {isEmpty ? (
        <EmptyState icon="👋" title="Welcome to Splitwise">
          <p className="muted">
            Track shared expenses with friends and groups. Everything is saved in this browser.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={() => setModal('group')}>Start a group</button>
            <button type="button" className="btn" onClick={() => setModal('friend')}>Add a friend</button>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: 'data/replace', data: demoData(data.settings.currency), message: 'You loaded the demo data.' })}
            >
              Load demo data
            </button>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="summary">
            <div>
              <small>Total balance</small>
              <strong className={net > 0 ? 'lent' : net < 0 ? 'borrowed' : ''}>
                {net > 0 ? '+' : net < 0 ? '−' : ''}
                {fmt(Math.abs(net))}
              </strong>
            </div>
            <div>
              <small>You owe</small>
              <strong className={totalOwe ? 'borrowed' : ''}>{fmt(totalOwe)}</strong>
            </div>
            <div>
              <small>You are owed</small>
              <strong className={totalOwed ? 'lent' : ''}>{fmt(totalOwed)}</strong>
            </div>
          </div>

          <div className="columns">
            <section>
              <h2 className="column-title">You owe</h2>
              {iOwe.length === 0 ? (
                <p className="muted pad">You don't owe anything.</p>
              ) : (
                <ul className="people-list">
                  {iOwe.map(({ friend, bal }) => (
                    <li key={friend.id}>
                      <Link to={`/friends/${friend.id}`}>
                        <Avatar person={friend} />
                        <span className="grow">
                          <strong>{friend.name}</strong>
                          <small className="borrowed">you owe {fmt(-bal)}</small>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="column-title right">You are owed</h2>
              {owedToMe.length === 0 ? (
                <p className="muted pad">You are not owed anything.</p>
              ) : (
                <ul className="people-list">
                  {owedToMe.map(({ friend, bal }) => (
                    <li key={friend.id}>
                      <Link to={`/friends/${friend.id}`}>
                        <Avatar person={friend} />
                        <span className="grow">
                          <strong>{friend.name}</strong>
                          <small className="lent">owes you {fmt(bal)}</small>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {modal === 'expense' && <ExpenseForm onClose={() => setModal(null)} />}
      {modal === 'settle' && (
        <SettleUpForm
          onClose={() => setModal(null)}
          from={ME}
          to={iOwe[0]?.friend.id ?? friends[0]?.id}
          amount={iOwe[0] ? -iOwe[0].bal : undefined}
        />
      )}
      {modal === 'friend' && <FriendForm onClose={() => setModal(null)} />}
      {modal === 'group' && <GroupForm onClose={() => setModal(null)} />}
    </>
  );
}
