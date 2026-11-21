import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { oneOf, usePref } from '../hooks/prefs';
import { searchTools, toolPath } from '../tools/registry';

type Theme = 'system' | 'light' | 'dark';
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const svgProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

/** Inline SVG icons (glyphs like ◐ render inconsistently across system fonts). */
function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light')
    return (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  if (theme === 'dark')
    return (
      <svg {...svgProps}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  return (
    <svg {...svgProps}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = usePref<Theme>('theme', 'system', oneOf('system', 'light', 'dark'));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, () => setTheme(THEME_NEXT[theme])];
}

const PRIVACY = 'Runs entirely in your browser — nothing is uploaded';

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, cycleTheme] = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const results = searchTools(query);

  // Close the drawer on navigation and move focus to the main content.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('no-scroll', open);
    if (open) searchRef.current?.focus();
  }, [open]);

  // "/" or Ctrl/Cmd+K focuses the tool search; Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        if (window.matchMedia('(max-width: 860px)').matches) setOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <header className="topbar">
        <button type="button" className="icon-btn menu-btn" aria-label={open ? 'Close tool menu' : 'Open tool menu'} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? '✕' : '☰'}</span>
        </button>
        <NavLink to="/" className="logo">
          <span className="logo-mark" aria-hidden="true">
            &lt;/&gt;
          </span>
          Dev Tools
        </NavLink>
        <span className="privacy-badge" title={PRIVACY}>
          <span aria-hidden="true">🔒</span> {PRIVACY}
        </span>
        <button type="button" className="icon-btn theme-btn" onClick={cycleTheme} aria-label={`Theme: ${theme}. Switch to ${THEME_NEXT[theme]}`} title={`Theme: ${theme}`}>
          <ThemeIcon theme={theme} />
        </button>
      </header>

      <div className="shell">
        <aside id="sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="Tools">
          <div className="search">
            <label htmlFor="tool-search" className="sr-only">
              Search tools
            </label>
            <input
              ref={searchRef}
              id="tool-search"
              type="search"
              placeholder="Search tools…"
              value={query}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) {
                  navigate(toolPath(results[0]));
                  setQuery('');
                }
              }}
              aria-describedby="search-hint"
            />
            <kbd className="search-kbd" aria-hidden="true">
              /
            </kbd>
            <span id="search-hint" className="sr-only">
              Press Enter to open the first match. Shortcut: slash or Control K.
            </span>
          </div>
          <nav aria-label="Tool list">
            <ul className="nav-list">
              <li>
                <NavLink to="/" end className="nav-link">
                  <span className="nav-icon" aria-hidden="true">
                    ⌂
                  </span>
                  All tools
                </NavLink>
              </li>
              {results.map((t) => (
                <li key={t.id}>
                  <NavLink to={toolPath(t)} className="nav-link">
                    <span className="nav-icon" aria-hidden="true">
                      {t.icon}
                    </span>
                    {t.name}
                  </NavLink>
                  {t.sub && t.sub.length > 1 && location.pathname.startsWith(`/${t.id}`) && (
                    <ul className="nav-sub">
                      {t.sub.map((s) => (
                        <li key={s.path}>
                          <NavLink to={toolPath(t, s.path)} end className="nav-sublink">
                            {s.name}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {results.length === 0 && <p className="nav-empty">No tools match “{query}”.</p>}
          </nav>
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

        <main id="main" className="main" tabIndex={-1}>
          <Suspense fallback={<div className="loading" role="status">Loading tool…</div>}>{children}</Suspense>
          <footer className="footer muted">
            <span aria-hidden="true">🔒</span> {PRIVACY}. Your inputs are never saved; only preferences such as theme are kept in this browser.
          </footer>
        </main>
      </div>
    </div>
  );
}
