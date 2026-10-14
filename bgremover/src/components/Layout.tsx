import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/prefs';
import { IconMonitor, IconMoon, IconSun, IconWand } from './Icons';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  if (theme === 'light') return <IconSun />;
  if (theme === 'dark') return <IconMoon />;
  return <IconMonitor />;
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
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" end className="logo" aria-label="Background Remover home">
          <span className="logo-mark" aria-hidden="true">
            <IconWand size={17} />
          </span>
          <span className="logo-text">Background Remover</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Remove
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Privacy &amp; models
          </NavLink>
        </nav>
        <span className="spacer" />
        <button type="button" className="btn ghost icon" onClick={cycle} aria-label={`${LABEL[theme]} (click to change)`} title={`${LABEL[theme]}: click to change`}>
          <ThemeIcon theme={theme} />
        </button>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
