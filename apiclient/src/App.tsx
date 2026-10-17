import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAppStore } from './store/AppStore';
import { RequestsPage } from './pages/RequestsPage';

const EnvironmentsPage = lazy(() => import('./pages/EnvironmentsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const RunnerPage = lazy(() => import('./pages/RunnerPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const LatencyPage = lazy(() => import('./pages/LatencyPage'));
const DataPage = lazy(() => import('./pages/DataPage'));
const ProxyPage = lazy(() => import('./pages/ProxyPage'));
const PostmanPage = lazy(() => import('./pages/PostmanPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'));

const TITLES: [RegExp, string][] = [
  [/^\/env/, 'Environments'],
  [/^\/history/, 'History'],
  [/^\/runner/, 'Runner'],
  [/^\/compare/, 'Compare'],
  [/^\/latency/, 'Latency'],
  [/^\/data/, 'Import & export'],
  [/^\/workspaces/, 'Workspaces'],
  [/^\/proxy/, 'Proxy'],
  [/^\/about/, 'About'],
];

export default function App() {
  const { pathname } = useLocation();
  const { state } = useAppStore();
  const ws = state.activeWorkspaceId;
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · API Client` : 'API Client';
  }, [pathname]);

  if (!state.ready) {
    return (
      <Layout>
        <div className="page centered">
          <span className="spinner" aria-hidden="true" /> Loading your workspaces…
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
        {/* Pages holding local state about one workspace's items remount when the workspace changes. */}
        <Routes>
          <Route path="/" element={<RequestsPage key={ws} />} />
          <Route path="/r/:cid/:iid" element={<RequestsPage key={ws} />} />
          <Route path="/e/:cid/:iid/:eid" element={<RequestsPage key={ws} />} />
          <Route path="/new/:tid" element={<RequestsPage key={ws} />} />
          <Route path="/c/:cid" element={<RequestsPage key={ws} />} />
          <Route path="/f/:cid/:fid" element={<RequestsPage key={ws} />} />
          <Route path="/env" element={<EnvironmentsPage key={ws} />} />
          <Route path="/env/:id" element={<EnvironmentsPage key={ws} />} />
          <Route path="/history" element={<HistoryPage key={ws} />} />
          <Route path="/runner" element={<RunnerPage key={ws} />} />
          <Route path="/runner/:runId" element={<RunnerPage key={ws} />} />
          <Route path="/compare" element={<ComparePage key={ws} />} />
          <Route path="/latency" element={<LatencyPage key={ws} />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/proxy" element={<ProxyPage />} />
          <Route path="/postman" element={<PostmanPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
