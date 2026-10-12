import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ActivityPage } from './pages/ActivityPage';
import { AllExpensesPage } from './pages/AllExpensesPage';
import { Dashboard } from './pages/Dashboard';
import { FriendPage } from './pages/FriendPage';
import { GroupPage } from './pages/GroupPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/expenses" element={<AllExpensesPage />} />
        <Route path="/groups/:groupId" element={<GroupPage />} />
        <Route path="/friends/:friendId" element={<FriendPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
