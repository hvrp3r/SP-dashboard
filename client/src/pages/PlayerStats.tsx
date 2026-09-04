import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as usersApi from '../api/users.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import Avatar from '../components/Avatar.jsx';
import RankBadge from '../components/RankBadge.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import ProfileBackdrop from '../components/ProfileBackdrop.jsx';
import { TRANSACTION_TYPE_LABELS } from '../lib/transactionLabels.js';
import type { EquippedCosmetic, PlayerStats as PlayerStatsType, SpTransactionType, User } from '../types.js';

export default function PlayerStats() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<User | null>(null);
  const [stats, setStats] = useState<PlayerStatsType | null>(null);
  const [equipped, setEquipped] = useState<EquippedCosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          </>
        )}
      </div>
    </ProfileBackdrop>
  );
}
