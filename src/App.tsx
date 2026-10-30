import { Route, Routes } from 'react-router-dom';
import AdminLanding from './pages/AdminLanding';
import ClubPage from './pages/ClubPage';
import SheetsPage from './pages/SheetsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AdminLanding />} />
      <Route path="/c/:token" element={<ClubPage />} />
      <Route path="/sheets/:meetId/:sessionId" element={<SheetsPage />} />
    </Routes>
  );
}
