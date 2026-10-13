import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Feedback';
import { Layout } from './components/Layout';
import { RecordPage } from './pages/RecordPage';
import { useController } from './store/RecorderContext';

const LibraryPage = lazy(() => import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const PlayerPage = lazy(() => import('./pages/PlayerPage').then((m) => ({ default: m.PlayerPage })));

function TitleSync() {
  const { pathname } = useLocation();
  const c = useController();
  useEffect(() => {
    if (pathname.startsWith('/play/')) return; // the player sets the recording's title
    c.setBaseTitle(pathname === '/library' ? 'Library · Recorder' : 'Recorder');
    window.scrollTo(0, 0);
  }, [pathname, c]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <Layout>
      <TitleSync />
      <ErrorBoundary key={pathname}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<RecordPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/play/:id" element={<PlayerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
