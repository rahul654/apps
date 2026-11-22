import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes, formatMinutes } from '../lib/format';
import { auth, logout, openLogin } from '../store/auth';
import { useStore } from '../store/createStore';
import { library } from '../store/library';
import { dismissToast, toasts } from '../store/toasts';
import { hasPendingUploads } from '../store/uploads';

export function Layout({ children, connected }: { children: ReactNode; connected: boolean }) {
  const { session, now } = useStore(auth);
  const lib = useStore(library);
  const pct = lib.limit ? Math.min(100, (lib.used / lib.limit) * 100) : 0;

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo" aria-hidden="true">
            ☁
          </span>
          Files
        </Link>
        {connected && lib.limit > 0 && (
          <div className="usage" title={`${formatBytes(lib.used)} of ${formatBytes(lib.limit)} used`}>
            <span className="usage-text tiny">
              {formatBytes(lib.used)} <span className="muted">/ {formatBytes(lib.limit)}</span>
            </span>
            <span className={`bar thin${pct > 90 ? ' warn' : ''}`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Space used">
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
        )}
        {connected &&
          (session ? (
            <div className="signed-in">
              <span className="pill ok" title="Upload login; ends after 1 hour">
                <span className="dot" aria-hidden="true" /> <span className="hide-xs">Signed in · </span>
                {formatMinutes(session.exp - now)} left
              </span>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  if (!hasPendingUploads() || confirm('Uploads are still running. Sign out anyway? They’ll pause until you sign in again.')) logout();
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" className="btn primary small" onClick={() => openLogin()}>
              ⬆ Upload
            </button>
          ))}
      </header>
      <main className="main">{children}</main>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const list = useStore(toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <button type="button" key={t.id} className={`toast ${t.tone}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
