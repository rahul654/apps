import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/prefs';
import { isFakeMode } from '../media/fake';
import { useController, useRecorder } from '../store/RecorderContext';
import { IconLibrary, IconLock, IconMoon, IconRecord, IconScreen, IconSun } from './Icons';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  if (theme === 'light') return <IconSun />;
  if (theme === 'dark') return <IconMoon />;
  return <IconScreen />;
}

function FakeBanner() {
  const c = useController();
  const s = useRecorder();
  return (
    <div className="fake-banner" role="note">
      <strong>Fake sources (test mode)</strong>
      <span className="muted small">Screen, camera and mic are generated. Remove <code>?fake=1</code> to use real devices.</span>
      {s.screen && (
        <button type="button" className="btn small" onClick={() => c.simulateStopSharing()}>
          Simulate “Stop sharing”
        </button>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  const { rec } = useRecorder();
  const recording = rec.phase === 'recording' || rec.phase === 'paused';
  const cycle = () => {
    const next = NEXT[theme];
    applyTheme(next);
    setTheme(next);
  };
  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      {isFakeMode() && <FakeBanner />}
      <header className="topbar">
        <NavLink to="/" className="logo" aria-label="Recorder home">
          <span className="logo-mark" aria-hidden="true">
            <IconRecord size={16} />
          </span>
          <span className="logo-text">Recorder</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <IconRecord size={14} /> Record
            {recording && <span className="rec-dot" aria-label={rec.phase === 'paused' ? '(paused)' : '(recording)'} />}
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <IconLibrary size={16} /> Library
          </NavLink>
        </nav>
        <span className="spacer" />
        <span className="privacy-note" title="Recordings are stored in this browser only. Nothing is uploaded.">
          <IconLock size={14} /> <span className="privacy-text">Stays on your device</span>
        </span>
        <button type="button" className="btn ghost icon" onClick={cycle} aria-label={`${LABEL[theme]} (click to change)`} title={`${LABEL[theme]}: click to change`}>
          <ThemeIcon theme={theme} />
        </button>
      </header>
      <main id="main" tabIndex={-1} className="main">
        {children}
      </main>
      <footer className="footer">Recorded and stored locally in your browser · No uploads, no tracking</footer>
    </>
  );
}
