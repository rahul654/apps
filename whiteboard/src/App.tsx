import { Navigate, Route, Routes } from 'react-router-dom';
import { LibraryPage } from './pages/LibraryPage';
import { BoardPage } from './pages/BoardPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/b/:id" element={<BoardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
