import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { createSandbox } from '../lib/defaults';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/prefs';
import { useSandboxes } from '../store/SandboxStore';
import { IconClose, IconCode, IconGlobe, IconMonitor, IconMoon, IconPlus, IconShield, IconSun } from './Icons';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  if (theme === 'light') return <IconSun />;
  if (theme === 'dark') return <IconMoon />;
  return <IconMonitor />;
}

/** Removes a sandbox and moves to its neighbour (or home) if it was the open one. */
export function useRemoveSandbox() {
  const { sandboxes, dispatch } = useSandboxes();
  const navigate = useNavigate();
  const active = useMatch('/s/:id')?.params.id;
  return (id: string) => {
    if (id === active) {
      const i = sandboxes.findIndex((sb) => sb.id === id);
      const neighbour = sandboxes[i + 1] ?? sandboxes[i - 1];
      navigate(neighbour ? `/s/${neighbour.id}` : '/', { replace: true });
    }
    dispatch({ type: 'remove', id });
  };
}

function TabStrip() {
  const { sandboxes, dispatch } = useSandboxes();
  const navigate = useNavigate();
  const remove = useRemoveSandbox();
  const newTab = () => {
    const sb = createSandbox('web');
    dispatch({ type: 'create', sandbox: sb });
    navigate(`/s/${sb.id}`);
  };
  return (
    <nav className="tabs" aria-label="Sandboxes">
      <div className="tabs-scroll">
        {sandboxes.map((sb) => (
          <div key={sb.id} className="tab">
            <NavLink to={`/s/${sb.id}`} className={({ isActive }) => (isActive ? 'tab-link active' : 'tab-link')} title={sb.kind === 'web' ? sb.url || sb.name : sb.name}>
              {sb.kind === 'html' ? <IconCode size={14} /> : <IconGlobe size={14} />}
              <span className="tab-name">{sb.name}</span>
            </NavLink>
            <button type="button" className="tab-close" onClick={() => remove(sb.id)} aria-label={`Close ${sb.name}`} title="Close sandbox">
              <IconClose size={13} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn ghost icon small" onClick={newTab} aria-label="New sandbox" title="New sandbox">
        <IconPlus size={16} />
      </button>
    </nav>
  );
}

function UndoToast() {
  const { removed, dispatch } = useSandboxes();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState<string | null>(null);
  const id = removed?.sandbox.id ?? null;
  useEffect(() => {
    if (!id) return;
    setHidden(null);
    const t = window.setTimeout(() => setHidden(id), 7000);
    return () => window.clearTimeout(t);
  }, [id]);
  if (!removed || hidden === id) return null;
  return (
    <div className="toast" role="status">
      <span>
        Closed <strong>{removed.sandbox.name}</strong>
      </span>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          dispatch({ type: 'restore', ...removed });
          navigate(`/s/${removed.sandbox.id}`);
        }}
      >
        Undo
      </button>
      <button type="button" className="btn ghost icon small" onClick={() => setHidden(id)} aria-label="Dismiss">
        <IconClose size={14} />
      </button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  const cycle = () => {
    const next = NEXT[theme];
    applyTheme(next);
    setTheme(next);
  };
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'logo active' : 'logo')} aria-label="Sandbox home" title="All sandboxes">
          <span className="logo-mark" aria-hidden="true">
            <IconShield size={17} />
          </span>
          <span className="logo-text">Sandbox</span>
        </NavLink>
        <TabStrip />
        <button type="button" className="btn ghost icon" onClick={cycle} aria-label={`${LABEL[theme]} (click to change)`} title={`${LABEL[theme]}: click to change`}>
          <ThemeIcon theme={theme} />
        </button>
      </header>
      <main id="main" className="main">
        {children}
      </main>
      <UndoToast />
    </div>
  );
}
