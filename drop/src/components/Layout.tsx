import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../store/session';

export function Layout({ children }: { children: ReactNode }) {
  const s = useSession();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo" aria-hidden="true">⇄</span> Drop
        </Link>
        {s.phase === 'connected' && (
          <Link to="/share" className="pill ok">
            <span className="dot" aria-hidden="true" /> Connected{s.peerName ? ` to ${s.peerName}` : ''}
          </Link>
        )}
      </header>
      <main className="main">{children}</main>
      <footer className="footer tiny muted">Files go straight between your devices, encrypted. Nothing is uploaded.</footer>
    </div>
  );
}
