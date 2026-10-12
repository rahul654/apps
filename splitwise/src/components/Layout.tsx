import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { balanceBetween } from '../lib/balances';
import { groupTypeOf } from '../lib/categories';
import { useApp } from '../store/AppStore';
import { ME } from '../types';
import { Avatar } from './Avatar';
import { FriendForm } from './FriendForm';
import { GroupForm } from './GroupForm';

export function Layout({ children }: { children: ReactNode }) {
  const { data, ledger } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<null | 'group' | 'friend'>(null);
  const location = useLocation();
  const friends = data.people.filter((p) => p.id !== ME);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const navClass = ({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? 'active' : ''}`;

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <Link to="/" className="logo">
          <span className="logo-mark">S</span> splitwise
        </Link>
        <a href="../" className="topbar-link">All apps</a>
      </header>

      <div className="shell">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <nav>
            <NavLink to="/" end className={navClass}>📊 Dashboard</NavLink>
            <NavLink to="/activity" className={navClass}>🔔 Recent activity</NavLink>
            <NavLink to="/expenses" className={navClass}>🧾 All expenses</NavLink>

            <div className="nav-section">
              <span>Groups</span>
              <button type="button" className="link-btn" onClick={() => setModal('group')}>+ add</button>
            </div>
            {data.groups.length === 0 && <p className="nav-empty">No groups yet</p>}
            {data.groups.map((g) => (
              <NavLink key={g.id} to={`/groups/${g.id}`} className={navClass}>
                {groupTypeOf(g.type).icon} {g.name}
              </NavLink>
            ))}

            <div className="nav-section">
              <span>Friends</span>
              <button type="button" className="link-btn" onClick={() => setModal('friend')}>+ add</button>
            </div>
            {friends.length === 0 && <p className="nav-empty">No friends yet</p>}
            {friends.map((f) => {
              const bal = balanceBetween(ledger, ME, f.id);
              return (
                <NavLink key={f.id} to={`/friends/${f.id}`} className={navClass}>
                  <Avatar person={f} size={20} />
                  <span className="grow">{f.name}</span>
                  {bal !== 0 && <span className={`dot ${bal > 0 ? 'lent' : 'borrowed'}`} aria-hidden="true" />}
                </NavLink>
              );
            })}

            <div className="nav-section" />
            <NavLink to="/settings" className={navClass}>⚙️ Settings</NavLink>
          </nav>
        </aside>
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

        <main className="main">{children}</main>
      </div>

      {modal === 'group' && <GroupForm onClose={() => setModal(null)} />}
      {modal === 'friend' && <FriendForm onClose={() => setModal(null)} />}
    </div>
  );
}
