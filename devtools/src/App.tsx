import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { getPref, setPref } from './hooks/prefs';
import { Home } from './pages/Home';
import { findTool, TOOLS } from './tools/registry';

/** Remember the last few tools (ids only — never inputs) and set the page title. */
function useToolHistory() {
  const { pathname } = useLocation();
  useEffect(() => {
    const tool = findTool(pathname.split('/')[1]);
    document.title = tool ? `${tool.name} · Dev Tools` : 'Dev Tools';
    if (!tool) return;
    const prev = getPref<unknown>('recent', []);
    const list = Array.isArray(prev) ? prev.filter((x): x is string => typeof x === 'string' && x !== tool.id) : [];
    setPref('recent', [tool.id, ...list].slice(0, 5));
    setPref('lastTool', tool.id);
  }, [pathname]);
}

export default function App() {
  useToolHistory();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        {TOOLS.map((t) => (
          <Route key={t.id} path={`/${t.id}/*`} element={<t.component />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
