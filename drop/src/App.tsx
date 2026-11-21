import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { GuestPage } from './pages/GuestPage';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { SharePage } from './pages/SharePage';
import { StartPage } from './pages/StartPage';
import { useSession } from './store/session';

/** Jump to the transfer page the moment a pairing connects, from whichever page did it. */
function GoToShareOnConnect() {
  const { phase } = useSession();
  const prev = useRef(phase);
  const navigate = useNavigate();
  useEffect(() => {
    if (phase === 'connected' && prev.current !== 'connected') navigate('/share', { replace: true });
    prev.current = phase;
  }, [phase, navigate]);
  return null;
}

export default function App() {
  return (
    <Layout>
      <GoToShareOnConnect />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/start" element={<StartPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/j/:code" element={<GuestPage />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
