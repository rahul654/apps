import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/prefs';
import { useJob } from '../store/job';
import { IconInfo, IconLibrary, IconMonitor, IconMoon, IconSun, IconWave } from './Icons';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  if (theme === 'light') return <IconSun />;
  if (theme === 'dark') return <IconMoon />;
  return <IconMonitor />;
}

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link');

export function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  const job = useJob();
  const cycle = () => {
    const next = NEXT[theme];
    applyTheme(next);
    setTheme(next);
  };
  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" end className="logo" aria-label="Speech to Text home">
          <span className="logo-mark" aria-hidden="true">
            <IconWave size={17} />
          </span>
          <span className="logo-text">Speech to Text</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            <IconWave size={16} />
            <span>Transcribe</span>
            {job.status === 'running' && <span className="dot busy" title="Transcribing" aria-label="(transcribing)" />}
          </NavLink>
          <NavLink to="/library" className={navClass}>
            <IconLibrary size={16} />
            <span>Library</span>
          </NavLink>
          <NavLink to="/about" className={navClass}>
            <IconInfo size={16} />
            <span>About</span>
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
