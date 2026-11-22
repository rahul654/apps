import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginDialog } from './components/LoginDialog';
import { SCRIPT_URL } from './lib/env';
import { LibraryPage } from './pages/LibraryPage';
import { SetupPage } from './pages/SetupPage';

export default function App() {
  const connected = Boolean(SCRIPT_URL);
  return (
    <Layout connected={connected}>
      {connected ? (
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/i/:id" element={<LibraryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <SetupPage />
      )}
      <LoginDialog />
    </Layout>
  );
}
