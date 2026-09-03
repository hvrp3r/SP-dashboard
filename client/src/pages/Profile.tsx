import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as transactionsApi from '../api/transactions.js';
import * as usersApi from '../api/users.js';
import * as gamblingApi from '../api/gambling.js';
import { TRANSACTION_TYPE_LABELS } from '../lib/transactionLabels.js';
import Avatar from '../components/Avatar.jsx';
import RankBadge from '../components/RankBadge.jsx';
import type { GamblingInventoryEntry, SpTransaction } from '../types.js';

const TRANSACTIONS_POLL_INTERVAL_MS = 10000;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Profile() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<SpTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [inventory, setInventory] = useState<GamblingInventoryEntry[]>([]);
  const [rank, setRank] = useState<number | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [bonusError, setBonusError] = useState<string | null>(null);
  const [bonusAmount, setBonusAmount] = useState<number | null>(null);
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

  useEffect(() => {
    gamblingApi.getMyInventory().then(setInventory).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    usersApi
      .getStats(user.username)
      .then((s) => setRank(s.rank))
      .catch(() => {});
  }, [user?.username]);

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

  async function handleClaimBonus() {
    setBonusError(null);
    setClaimingBonus(true);
    try {
      const result = await usersApi.claimDailyBonus();
      setUser(result.profile);
      if (result.alreadyClaimed) {
        setBonusError('Bonus déjà réclamé aujourd\'hui.');
      } else {
        setBonusAmount(result.amount);
      }
    } catch (err) {
      setBonusError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setClaimingBonus(false);
    }
  }

  if (!user) return null;

  const bonusClaimedToday = user.last_login_date === todayUTC();

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
            <Avatar
              username={user.username}
              avatarUrl={user.avatar_url}
              size={64}
              crown={rank === 1}
            />
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
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-50">{user.username}</h1>
              {rank !== undefined && <RankBadge rank={rank} size="sm" />}
            </div>
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

        <div className="flex items-center justify-between gap-4 bg-zinc-800 rounded-lg p-4 mb-4">
          <div>
            <p className="text-sm font-medium text-zinc-100">
              {bonusClaimedToday ? 'Bonus quotidien réclamé ✓' : 'Bonus quotidien disponible'}
            </p>
            <p className="text-xs text-zinc-500">
              {bonusClaimedToday
                ? 'Reviens demain pour continuer ta série.'
                : 'Réclame-le pour garder ta série en vie.'}
            </p>
            {bonusAmount !== null && (
              <p className="text-xs text-emerald-400 font-medium mt-1">+{bonusAmount} SP reçus</p>
            )}
          </div>
          {!bonusClaimedToday && (
            <button
              onClick={handleClaimBonus}
              disabled={claimingBonus}
              className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              {claimingBonus ? '…' : 'Réclamer'}
            </button>
          )}
        </div>
        {bonusError && <p className="mb-4 text-sm text-red-400">{bonusError}</p>}

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

        {inventory.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
              Collection gambling
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {inventory.map((item) => (
                <div
                  key={item.id}
                  className="bg-zinc-800/60 rounded-lg p-2 flex flex-col items-center text-center"
                  title={item.title}
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      className="w-10 h-10 rounded-lg object-cover mb-1"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center text-lg mb-1">
                      🎁
                    </div>
                  )}
                  <p className="text-xs text-zinc-300 truncate w-full">{item.title}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
