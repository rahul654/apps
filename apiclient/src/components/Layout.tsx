import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/prefs';
import { useAppStore } from '../store/AppStore';
import { WorkspaceSelect } from './WorkspaceSwitcher';
import { IconBox, IconChart, IconClock, IconDiff, IconInfo, IconLayers, IconMonitor, IconMoon, IconPlay, IconPlug, IconSend, IconSun } from './Icons';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  if (theme === 'light') return <IconSun />;
  if (theme === 'dark') return <IconMoon />;
  return <IconMonitor />;
}

export function EnvironmentSelect({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useAppStore();
  return (
    <label className={compact ? 'env-select compact' : 'env-select'}>
      <span className="sr-only">Active environment (this workspace)</span>
      <select className="input compact" value={state.activeEnvironmentId ?? ''} onChange={(e) => dispatch({ type: 'environment/active', id: e.target.value || null })} title="Active environment">
        <option value="">No environment</option>
        {state.environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const NAV = [
  { to: '/', label: 'Requests', icon: IconSend, end: true },
  { to: '/env', label: 'Environments', icon: IconLayers },
  { to: '/history', label: 'History', icon: IconClock },
  { to: '/runner', label: 'Runner', icon: IconPlay },
  { to: '/compare', label: 'Compare', icon: IconDiff },
  { to: '/latency', label: 'Latency', icon: IconChart },
  { to: '/data', label: 'Data', icon: IconBox },
  { to: '/proxy', label: 'Proxy', icon: IconPlug },
  { to: '/about', label: 'About', icon: IconInfo },
];

export function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const { state } = useAppStore();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="logo" aria-label="API Client home">
          <span className="logo-mark">
            <IconSend size={16} />
          </span>
          <span className="logo-text">API Client</span>
        </NavLink>
        <nav className="nav" aria-label="Sections">
          {NAV.map(({ to, label, icon: I, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} title={label}>
              <I size={16} />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        {state.prefs.mode === 'proxy' && (
          <NavLink to="/proxy" className="pill proxy-pill" title="Requests go through the local proxy">
            proxy
          </NavLink>
        )}
        <WorkspaceSelect className="topbar-ws" />
        <EnvironmentSelect compact />
        <button type="button" className="btn ghost icon" onClick={() => setTheme(NEXT[theme])} aria-label={`${LABEL[theme]} (click to change)`} title={LABEL[theme]}>
          <ThemeIcon theme={theme} />
        </button>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
