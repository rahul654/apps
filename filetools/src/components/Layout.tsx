import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/storage';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const ICON: Record<ThemeChoice, string> = { system: '🖥️', light: '☀️', dark: '🌙' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

export function Layout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  const cycle = () => {
    const next = NEXT[theme];
    applyTheme(next);
    setTheme(next);
  };
  return (
    <>
      <a href="#main" className="sr-only" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="logo" aria-label="File Tools home">
          <span className="logo-mark" aria-hidden="true">🧰</span>
          <span className="logo-text">File Tools</span>
        </Link>
        <span className="privacy-note" title="All processing happens in your browser. Nothing is uploaded.">
          <span aria-hidden="true">🔒</span> Files never leave your device
        </span>
        <span className="spacer" />
        <button type="button" className="btn ghost icon" onClick={cycle} aria-label={`${LABEL[theme]} (click to change)`} title={`${LABEL[theme]} — click to change`}>
          <span aria-hidden="true">{ICON[theme]}</span>
        </button>
      </header>
      <main id="main" tabIndex={-1} className={wide ? 'main wide' : 'main'}>
        {children}
      </main>
      {!wide && <footer className="footer">Processed locally in your browser · No uploads, no tracking</footer>}
    </>
  );
}
