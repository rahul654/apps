import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { PlayerPanel } from './components/PlayerPanel';
import { loadCatalog } from './lib/catalog';
import { buildViews } from './lib/views';
import { CategoryPage } from './pages/CategoryPage';
import { HomePage } from './pages/HomePage';
import { next, prev, togglePlay } from './store/player';
import type { Catalog } from './types';

type Load = { status: 'loading' } | { status: 'ready'; catalog: Catalog } | { status: 'error'; message: string };

function useCatalog(): [Load, () => void] {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    loadCatalog().then(
      (catalog) => live && setLoad({ status: 'ready', catalog }),
      (err: unknown) => live && setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);
  return [load, retry];
}

/** Space = play/pause, ←/→ = previous/next clip, unless typing or on a control that uses the key. */
function useKeyboard() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="slider"]')) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const [load, retry] = useCatalog();
  const catalog = load.status === 'ready' ? load.catalog : null;
  const views = useMemo(() => (catalog ? buildViews(catalog) : null), [catalog]);
  useKeyboard();

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand" end>
          <span className="logo" aria-hidden="true">♪</span> Music Hooks
        </NavLink>
        {catalog && (
          <nav className="tabs" aria-label="Categories">
            <NavLink to="/" end className="tab">
              All <span className="tab-count">{views?.all.length}</span>
            </NavLink>
            {catalog.categories.map((c) => (
              <NavLink key={c.id} to={`/c/${c.id}`} className="tab">
                {c.title} <span className="tab-count">{c.songs.length}</span>
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <div className="layout">
        <aside className="side">
          <PlayerPanel />
        </aside>
        <main className="content">
          {load.status === 'loading' && (
            <p className="status" role="status">
              <span className="spinner" aria-hidden="true" /> Loading songs…
            </p>
          )}
          {load.status === 'error' && (
            <div className="card error-card" role="alert">
              <h1>Couldn’t load the songs</h1>
              <p className="break">{load.message}</p>
              <button type="button" className="btn primary" onClick={retry}>
                Try again
              </button>
            </div>
          )}
          {catalog && views && (
            <Routes>
              <Route path="/" element={<HomePage catalog={catalog} views={views} />} />
              <Route path="/c/:categoryId" element={<CategoryPage catalog={catalog} views={views} />} />
              <Route
                path="*"
                element={
                  <div className="notfound">
                    <h1>Page not found</h1>
                    <NavLink className="btn primary" to="/">
                      Show all songs
                    </NavLink>
                  </div>
                }
              />
            </Routes>
          )}
        </main>
      </div>
      <footer className="footer tiny muted">
        Clips are YouTube’s “Most replayed” parts, played in YouTube’s own player.
        {catalog && catalog.generatedAt !== 'stub' && ` Updated ${catalog.generatedAt}.`}
      </footer>
    </div>
  );
}
