import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Profile from './pages/Profile.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Challenges from './pages/Challenges.jsx';
import Minigames from './pages/Minigames.jsx';
import MinigameDetail from './pages/MinigameDetail.jsx';
import Gambling from './pages/Gambling.jsx';
import GamblingCrateDetail from './pages/GamblingCrateDetail.jsx';
import PlayerStats from './pages/PlayerStats.jsx';
import AdminSeasons from './pages/admin/Seasons.jsx';
import AdminConfig from './pages/admin/Config.jsx';
import AdminTransactions from './pages/admin/Transactions.jsx';
import AdminChallenges from './pages/admin/Challenges.jsx';
import NavBar from './components/NavBar.jsx';
import { useAuth } from './hooks/useAuth.jsx';

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? children : <Navigate to="/connexion" replace />;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/connexion" replace />;
  return user.role === 'admin' ? children : <Navigate to="/profil" replace />;
}

export default function App() {
  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/connexion" element={<Login />} />
        <Route path="/inscription" element={<Register />} />
        <Route
          path="/profil"
          element={
            <PrivateRoute>
              <Profile />
            </PrivateRoute>
          }
        />
        <Route
          path="/classement"
          element={
            <PrivateRoute>
              <Leaderboard />
            </PrivateRoute>
          }
        />
        <Route path="/archives" element={<Navigate to="/classement" replace />} />
        <Route
          path="/joueurs/:username"
          element={
            <PrivateRoute>
              <PlayerStats />
            </PrivateRoute>
          }
        />
        <Route
          path="/defis"
          element={
            <PrivateRoute>
              <Challenges />
            </PrivateRoute>
          }
        />
        <Route
          path="/mini-jeux"
          element={
            <PrivateRoute>
              <Minigames />
            </PrivateRoute>
          }
        />
        <Route
          path="/mini-jeux/:id"
          element={
            <PrivateRoute>
              <MinigameDetail />
            </PrivateRoute>
          }
        />
        <Route
          path="/gambling"
          element={
            <PrivateRoute>
              <Gambling />
            </PrivateRoute>
          }
        />
        <Route
          path="/gambling/:id"
          element={
            <PrivateRoute>
              <GamblingCrateDetail />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/saisons"
          element={
            <AdminRoute>
              <AdminSeasons />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/config"
          element={
            <AdminRoute>
              <AdminConfig />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/transactions"
          element={
            <AdminRoute>
              <AdminTransactions />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/defis"
          element={
            <AdminRoute>
              <AdminChallenges />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/profil" replace />} />
      </Routes>
    </>
  );
}
