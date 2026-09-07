import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as usersApi from '../api/users.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import * as transactionsApi from '../api/transactions.js';
import Avatar from '../components/Avatar.jsx';
import RankBadge from '../components/RankBadge.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import ProfileBackdrop from '../components/ProfileBackdrop.jsx';
import ProfileReactions from '../components/ProfileReactions.jsx';
import { TRANSACTION_TYPE_LABELS } from '../lib/transactionLabels.js';
import type {
  EquippedCosmetic,
  PlayerStats as PlayerStatsType,
  ProfileReactionSummary,
  ProfileReactionValue,
  SpTransaction,
  SpTransactionType,
  User,
} from '../types.js';

const TRANSACTIONS_PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function PlayerStats() {
  const { username } = useParams<{ username: string }>();
  const { user: viewer } = useAuth();
  const [profile, setProfile] = useState<User | null>(null);
  const [stats, setStats] = useState<PlayerStatsType | null>(null);
  const [equipped, setEquipped] = useState<EquippedCosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<ProfileReactionSummary | null>(null);
  const isOwnProfile = Boolean(viewer && username && viewer.username === username);

  const [transactions, setTransactions] = useState<SpTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    Promise.all([usersApi.getPublicProfile(username), usersApi.getStats(username)])
      .then(([p, s]) => {
        setProfile(p);
        setStats(s);
        setError(null);
        cosmeticsApi
          .getForUser(p.id)
          .then(setEquipped)
          .catch(() => {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'))
      .finally(() => setLoading(false));
  }, [username]);

  useEffect(() => {
    if (!username) return;
    setTransactions([]);
    setHasMoreTransactions(true);
    setLoadingTransactions(true);
    transactionsApi
      .getTransactionsForUsername(username, TRANSACTIONS_PAGE_SIZE, 0)
      .then((data) => {
        setTransactions(data);
        setHasMoreTransactions(data.length === TRANSACTIONS_PAGE_SIZE);
      })
      .catch(() => {
        // Silencieux : la section reste vide plutôt que de bloquer le reste du profil.
      })
      .finally(() => setLoadingTransactions(false));
  }, [username]);

  useEffect(() => {
    if (!username) return;
    setReactions(null);
    usersApi
      .getProfileReactions(username)
      .then(setReactions)
      .catch(() => {});
  }, [username]);

  async function handleReact(value: ProfileReactionValue) {
    if (!username || !reactions) return;
    const prevReaction = reactions.userReaction;
    const nextReaction = prevReaction === value ? 0 : value;
    setReactions((prev) => {
      if (!prev) return prev;
      let { likeCount, dislikeCount } = prev;
      if (prevReaction === 1) likeCount -= 1;
      if (prevReaction === -1) dislikeCount -= 1;
      if (nextReaction === 1) likeCount += 1;
      if (nextReaction === -1) dislikeCount += 1;
      return { likeCount, dislikeCount, userReaction: nextReaction };
    });
    try {
      const result = await usersApi.castProfileReaction(username, value);
      setReactions(result);
    } catch {
      usersApi
        .getProfileReactions(username)
        .then(setReactions)
        .catch(() => {});
    }
  }

  async function handleLoadMoreTransactions() {
    if (!username) return;
    setLoadingMoreTransactions(true);
    try {
      const next = await transactionsApi.getTransactionsForUsername(
        username,
        TRANSACTIONS_PAGE_SIZE,
        transactions.length
      );
      setTransactions((prev) => [...prev, ...next]);
      setHasMoreTransactions(next.length === TRANSACTIONS_PAGE_SIZE);
    } catch {
      // Silencieux : le bouton "Charger plus" reste disponible pour réessayer.
    } finally {
      setLoadingMoreTransactions(false);
    }
  }

  const bannerUrl = equipped.find((c) => c.slot === 'banner')?.image_url ?? null;
  const frameUrl = equipped.find((c) => c.slot === 'avatar_frame')?.image_url ?? null;

  return (
    <ProfileBackdrop bannerUrl={bannerUrl}>
      <div className="max-w-2xl mx-auto">
        <Link to="/classement" className="text-sm text-emerald-400 font-medium">
          ← Classement
        </Link>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="mt-4 text-zinc-500">Chargement…</p>
        ) : !profile || !stats ? (
          <p className="mt-4 text-zinc-500">Joueur introuvable.</p>
        ) : (
          <>
            <div className="flex items-center gap-4 mt-4 mb-6">
              <Avatar
                username={profile.username}
                avatarUrl={profile.avatar_url}
                size={64}
                crown={stats.rank === 1}
                frameUrl={frameUrl}
              />
              <div>
                <UserNameTag username={profile.username} equipped={equipped} className="text-2xl text-zinc-50" />
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm text-zinc-400">
                    {profile.role === 'admin' ? 'MSP' : 'Joueur'}
                  </p>
                  <RankBadge rank={stats.rank} size="sm" />
                </div>
              </div>
            </div>

            {reactions && (
              <div className="mb-6">
                <ProfileReactions
                  likeCount={reactions.likeCount}
                  dislikeCount={reactions.dislikeCount}
                  userReaction={reactions.userReaction}
                  onReact={isOwnProfile ? undefined : handleReact}
                />
              </div>
            )}

            <dl className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-emerald-500/10 rounded-lg p-4">
                <dt className="text-xs text-zinc-400 uppercase">Solde SP</dt>
                <dd className="text-2xl font-bold text-emerald-400">{profile.sp_balance}</dd>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <dt className="text-xs text-zinc-400 uppercase">Total gagné</dt>
                <dd className="text-2xl font-bold text-zinc-100">{profile.sp_total_earned}</dd>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <dt className="text-xs text-zinc-400 uppercase">Streak</dt>
                <dd className="text-2xl font-bold text-zinc-100">{profile.login_streak} 🔥</dd>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <dt className="text-xs text-zinc-400 uppercase">Défis</dt>
                <dd className="text-2xl font-bold text-zinc-100">
                  <span className="text-emerald-400">{stats.challenges.wins}V</span>
                  {' / '}
                  <span className="text-red-400">{stats.challenges.losses}D</span>
                </dd>
              </div>
            </dl>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-300 uppercase">SP par source</h2>
              </div>
              {Object.keys(stats.transactionTotals).length === 0 ? (
                <p className="p-6 text-center text-zinc-500">Aucune transaction pour le moment.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {(Object.keys(TRANSACTION_TYPE_LABELS) as SpTransactionType[])
                        .filter((type) => stats.transactionTotals[type])
                        .map((type) => {
                          const entry = stats.transactionTotals[type]!;
                          return (
                            <tr key={type} className="border-t border-zinc-800 first:border-0">
                              <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                                {TRANSACTION_TYPE_LABELS[type]}
                                <span className="text-zinc-500"> ({entry.count})</span>
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-bold ${
                                  entry.total >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {entry.total >= 0 ? '+' : ''}
                                {entry.total}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mt-6">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-300 uppercase">
                  Historique des transactions
                </h2>
              </div>
              {loadingTransactions ? (
                <p className="p-6 text-center text-zinc-500">Chargement…</p>
              ) : transactions.length === 0 ? (
                <p className="p-6 text-center text-zinc-500">Aucune transaction pour le moment.</p>
              ) : (
                <div className="p-4">
                  <ul className="space-y-2">
                    {transactions.map((tx) => (
                      <li
                        key={tx.id}
                        className={`flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2 text-sm ${
                          tx.revoked_at ? 'opacity-50' : ''
                        }`}
                      >
                        <div>
                          <p className="text-zinc-200">{TRANSACTION_TYPE_LABELS[tx.type]}</p>
                          <p className="text-xs text-zinc-500">
                            {formatDate(tx.created_at)}
                            {tx.note ? ` · ${tx.note}` : ''}
                          </p>
                          {tx.revoked_at && (
                            <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                              Révoquée
                            </span>
                          )}
                        </div>
                        <span
                          className={`font-bold whitespace-nowrap ${
                            tx.revoked_at
                              ? 'line-through text-zinc-500'
                              : tx.amount >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                          }`}
                        >
                          {tx.amount >= 0 ? '+' : ''}
                          {tx.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {hasMoreTransactions && (
                    <button
                      type="button"
                      onClick={handleLoadMoreTransactions}
                      disabled={loadingMoreTransactions}
                      className="mt-3 w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-md transition disabled:opacity-50"
                    >
                      {loadingMoreTransactions ? 'Chargement…' : 'Charger plus'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ProfileBackdrop>
  );
}
