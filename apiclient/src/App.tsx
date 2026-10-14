import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useWorkspace } from './store/Workspace';
import { WorkspacePage } from './pages/WorkspacePage';

const EnvironmentsPage = lazy(() => import('./pages/EnvironmentsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const RunnerPage = lazy(() => import('./pages/RunnerPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const LatencyPage = lazy(() => import('./pages/LatencyPage'));
const DataPage = lazy(() => import('./pages/DataPage'));
const ProxyPage = lazy(() => import('./pages/ProxyPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));

const TITLES: [RegExp, string][] = [
  [/^\/env/, 'Environments'],
  [/^\/history/, 'History'],
  [/^\/runner/, 'Runner'],
  [/^\/compare/, 'Compare'],
  [/^\/latency/, 'Latency'],
  [/^\/data/, 'Import & export'],
  [/^\/proxy/, 'Proxy'],
  [/^\/about/, 'About'],
];

export default function App() {
  const { pathname } = useLocation();
  const { state } = useWorkspace();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · API Client` : 'API Client';
  }, [pathname]);

  if (!state.ready) {
    return (
      <Layout>
        <div className="page centered">
          <span className="spinner" aria-hidden="true" /> Loading your workspace…
        </div>
      </Layout>
    );
  }
  return (
    <Layout>
      {state.loadError && (
        <div className="bar warn" role="alert">
          Storage could not be opened ({state.loadError}). You can still use the app, but nothing will be saved.
        </div>
      )}
      <Suspense
        fallback={
          <div className="page centered">
            <span className="spinner" aria-hidden="true" /> Loading…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/r/:cid/:iid" element={<WorkspacePage />} />
          <Route path="/c/:cid" element={<WorkspacePage />} />
          <Route path="/f/:cid/:fid" element={<WorkspacePage />} />
          <Route path="/env" element={<EnvironmentsPage />} />
          <Route path="/env/:id" element={<EnvironmentsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/runner" element={<RunnerPage />} />
          <Route path="/runner/:runId" element={<RunnerPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/latency" element={<LatencyPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/proxy" element={<ProxyPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
