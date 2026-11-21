import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Loading } from './components/Feedback';
import { Home } from './pages/Home';
import { TOOLS } from './tools/registry';

function TitleSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const tool = TOOLS.find((t) => t.path === pathname);
    document.title = tool ? `${tool.title} · File Tools` : 'File Tools';
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  const wide = TOOLS.find((t) => t.path === pathname)?.wide ?? false;
  return (
    <Layout wide={wide}>
      <TitleSync />
      <ErrorBoundary key={pathname}>
        <Suspense fallback={<Loading label="Loading tool…" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            {TOOLS.map((t) => (
              <Route key={t.id} path={t.path} element={<t.component />} />
            ))}
            <Route path="/pdf" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
