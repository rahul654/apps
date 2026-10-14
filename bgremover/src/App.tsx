import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AboutPage } from './pages/AboutPage';
import { WorkspacePage } from './pages/WorkspacePage';

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pathname === '/about' ? 'Privacy & models · Background Remover' : 'Background Remover';
  }, [pathname]);
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<WorkspacePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
