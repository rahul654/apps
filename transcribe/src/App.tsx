import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AboutPage } from './pages/AboutPage';
import { LibraryPage } from './pages/LibraryPage';
import { TranscribePage } from './pages/TranscribePage';
import { TranscriptPage } from './pages/TranscriptPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TranscribePage />} />
        <Route path="/t/:id" element={<TranscriptPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
