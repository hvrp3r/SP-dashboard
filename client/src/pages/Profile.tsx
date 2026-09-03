import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as transactionsApi from '../api/transactions.js';
import * as usersApi from '../api/users.js';
import { TRANSACTION_TYPE_LABELS } from '../lib/transactionLabels.js';
import Avatar from '../components/Avatar.jsx';
import type { SpTransaction } from '../types.js';

const TRANSACTIONS_POLL_INTERVAL_MS = 10000;

export default function Profile() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<SpTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function loadTransactions() {
      return transactionsApi
        .getMyTransactions(10)
        .then(setTransactions)
        .catch(() => {
          // Silencieux en arrière-plan : la liste garde ses dernières valeurs connues.
        })
        .finally(() => setLoadingTransactions(false));
    }
    loadTransactions();
    const interval = setInterval(loadTransactions, TRANSACTIONS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/connexion');
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAvatarError(null);
    setUploading(true);
    try {
      const updated = await usersApi.uploadAvatar(file);
      setUser(updated);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleVisibility() {
    if (!user) return;
    setVisibilityError(null);
    setTogglingVisibility(true);
    try {
      const updated = await usersApi.setLeaderboardVisibility(!user.is_leaderboard_hidden);
      setUser(updated);
    } catch (err) {
      setVisibilityError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setTogglingVisibility(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center py-10 px-4">
      <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-xl shadow-md w-full max-w-md">
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative group disabled:opacity-50"
            title="Changer l'avatar"
          >
            <Avatar username={user.username} avatarUrl={user.avatar_url} size={64} />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-xs text-white">
              {uploading ? '…' : 'Modifier'}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarChange}
            className="hidden"
          />
          <div>
            <h1 className="text-xl font-bold text-zinc-50">{user.username}</h1>
            <p className="text-sm text-zinc-400">{user.email}</p>
            <Link
              to={`/joueurs/${user.username}`}
              className="text-xs text-emerald-400 font-medium hover:underline"
            >
              Voir mes stats détaillées →
            </Link>
          </div>
        </div>

        {avatarError && <p className="mb-4 text-sm text-red-400">{avatarError}</p>}

        <dl className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-emerald-500/10 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Solde SP</dt>
            <dd className="text-2xl font-bold text-emerald-400">{user.sp_balance}</dd>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Total gagné</dt>
            <dd className="text-2xl font-bold text-zinc-100">{user.sp_total_earned}</dd>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Streak</dt>
            <dd className="text-2xl font-bold text-zinc-100">{user.login_streak} 🔥</dd>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Rôle</dt>
            <dd className="text-2xl font-bold text-zinc-100">
              {user.role === 'admin' ? 'MSP' : 'Joueur'}
            </dd>
          </div>
        </dl>

        {user.role === 'admin' && (
          <div className="flex items-center justify-between gap-4 bg-zinc-800 rounded-lg p-4 mb-4">
            <div>
              <p className="text-sm font-medium text-zinc-100">Invisible du classement</p>
              <p className="text-xs text-zinc-500">
                Masque ton compte MSP du classement, des archives de saison et du rang des autres
                joueurs.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={user.is_leaderboard_hidden}
              onClick={handleToggleVisibility}
              disabled={togglingVisibility}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
                user.is_leaderboard_hidden ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                  user.is_leaderboard_hidden ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}
        {visibilityError && <p className="mb-4 text-sm text-red-400">{visibilityError}</p>}

        <button
          onClick={handleLogout}
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold py-2 rounded-md transition mb-6"
        >
          Déconnexion
        </button>

        <div>
          <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
            Transactions récentes
          </h2>
          {loadingTransactions ? (
            <p className="text-sm text-zinc-500">Chargement…</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune transaction pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2 text-sm"
                >
                  <div>
                    <p className="text-zinc-200">{TRANSACTION_TYPE_LABELS[tx.type]}</p>
                    {tx.note && <p className="text-xs text-zinc-500">{tx.note}</p>}
                  </div>
                  <span
                    className={`font-bold ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {tx.amount >= 0 ? '+' : ''}
                    {tx.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
