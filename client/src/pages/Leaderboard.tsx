import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import * as leaderboardApi from '../api/leaderboard.js';
import * as seasonsApi from '../api/seasons.js';
import Avatar from '../components/Avatar.jsx';
import RankBadge from '../components/RankBadge.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import type { LeaderboardEntry, LeaderboardSort, Season, SeasonSnapshotEntry } from '../types.js';

const POLL_INTERVAL_MS = 60_000;

type View = 'live' | 'archives';

function SortableHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3 text-right">
      <button
        type="button"
        onClick={onClick}
        className={`group inline-flex items-center gap-1 transition-all duration-150 transform hover:scale-105 active:scale-95 cursor-pointer ${
          active ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <span className={active ? 'font-bold' : undefined}>{label}</span>
        <span
          className={`text-[10px] transition-opacity duration-150 ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
          }`}
          style={active ? { animation: 'popIn 0.25s ease-out' } : undefined}
        >
          ▼
        </span>
      </button>
    </th>
  );
}

export default function Leaderboard() {
  const [view, setView] = useState<View>('live');
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<LeaderboardSort>('sp_balance');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);

  const [pastSeasons, setPastSeasons] = useState<Season[]>([]);
  const [pastSeasonsLoaded, setPastSeasonsLoaded] = useState(false);
  const [loadingPastSeasons, setLoadingPastSeasons] = useState(false);
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<SeasonSnapshotEntry[]>([]);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  const fetchLeaderboard = useCallback(async (currentSort: LeaderboardSort) => {
    try {
      const data = await leaderboardApi.getLeaderboard(currentSort);
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    seasonsApi.getActiveSeason().then(setActiveSeason).catch(() => setActiveSeason(null));
  }, []);

  useEffect(() => {
    if (view !== 'live') return;
    setLoading(true);
    fetchLeaderboard(sort);
    const interval = setInterval(() => fetchLeaderboard(sort), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [view, sort, fetchLeaderboard]);

  useEffect(() => {
    if (view !== 'archives' || pastSeasonsLoaded) return;
    setLoadingPastSeasons(true);
    seasonsApi
      .listSeasons('closed')
      .then((data) => {
        setPastSeasons(data);
        if (data[0]) setSelectedSeasonId(data[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'))
      .finally(() => {
        setLoadingPastSeasons(false);
        setPastSeasonsLoaded(true);
      });
  }, [view, pastSeasonsLoaded]);

  useEffect(() => {
    if (view !== 'archives' || selectedSeasonId === null) return;
    setLoadingSnapshot(true);
    seasonsApi
      .getSeasonSnapshot(selectedSeasonId)
      .then((data) => setSnapshot(data.snapshot))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'))
      .finally(() => setLoadingSnapshot(false));
  }, [view, selectedSeasonId]);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-50">Classement</h1>
          {view === 'live' && activeSeason && (
            <p className="text-sm text-zinc-400">Saison active : {activeSeason.name}</p>
          )}
        </div>

        <div className="flex gap-4 mb-6 border-b border-zinc-800">
          <button
            onClick={() => setView('live')}
            className={`pb-2 text-sm font-medium border-b-2 transition ${
              view === 'live'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Saison en cours
          </button>
          <button
            onClick={() => setView('archives')}
            className={`pb-2 text-sm font-medium border-b-2 transition ${
              view === 'archives'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Archives
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {view === 'live' ? (
          <>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
              {loading ? (
                <p className="p-6 text-center text-zinc-500">Chargement…</p>
              ) : entries.length === 0 ? (
                <p className="p-6 text-center text-zinc-500">Aucun joueur pour le moment.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs select-none">
                      <tr>
                        <th className="px-4 py-3 text-left">Rang</th>
                        <th className="px-4 py-3 text-left">Joueur</th>
                        <SortableHeader
                          label="Solde SP"
                          active={sort === 'sp_balance'}
                          onClick={() => setSort('sp_balance')}
                        />
                        <SortableHeader
                          label="Total gagné"
                          active={sort === 'sp_total_earned'}
                          onClick={() => setSort('sp_total_earned')}
                        />
                      </tr>
                    </thead>
                    <tbody key={sort} style={{ animation: 'fadeIn 0.25s ease-out' }}>
                      {entries.map((entry, i) => (
                        <tr key={entry.id} className="border-t border-zinc-800">
                          <td className="px-4 py-3">
                            <RankBadge rank={i + 1} size="sm" />
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/joueurs/${entry.username}`}
                              className="flex items-center gap-2 hover:opacity-80 transition"
                            >
                              <Avatar
                                username={entry.username}
                                avatarUrl={entry.avatar_url}
                                size={32}
                                crown={i + 1 === 1}
                                frameUrl={
                                  entry.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')
                                    ?.image_url ?? null
                                }
                              />
                              <UserNameTag
                                username={entry.username}
                                equipped={entry.equipped_cosmetics}
                                className="text-zinc-100"
                              />
                              {entry.role === 'admin' && (
                                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                                  MSP
                                </span>
                              )}
                            </Link>
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${
                              sort === 'sp_balance' ? 'font-bold text-emerald-400' : 'text-zinc-400'
                            }`}
                          >
                            {entry.sp_balance}
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${
                              sort === 'sp_total_earned'
                                ? 'font-bold text-emerald-400'
                                : 'text-zinc-400'
                            }`}
                          >
                            {entry.sp_total_earned}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : loadingPastSeasons ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : pastSeasons.length === 0 ? (
          <p className="text-zinc-500">Aucune saison archivée pour le moment.</p>
        ) : (
          <>
            <label className="block mb-4">
              <span className="text-sm text-zinc-400">Saison</span>
              <select
                value={selectedSeasonId ?? ''}
                onChange={(e) => setSelectedSeasonId(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {pastSeasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
              {loadingSnapshot ? (
                <p className="p-6 text-center text-zinc-500">Chargement…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                      <tr>
                        <th className="px-4 py-3 text-left">Rang</th>
                        <th className="px-4 py-3 text-left">Joueur</th>
                        <th className="px-4 py-3 text-right">Solde final</th>
                        <th className="px-4 py-3 text-right">Total gagné</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.map((entry) => (
                        <tr key={entry.id} className="border-t border-zinc-800">
                          <td className="px-4 py-3">
                            <RankBadge rank={entry.rank} size="sm" />
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/joueurs/${entry.username}`}
                              className="font-medium text-zinc-100 hover:opacity-80 transition whitespace-nowrap"
                            >
                              {entry.username}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-right text-zinc-400">
                            {entry.final_balance}
                          </td>
                          <td className="px-4 py-3 text-right text-zinc-400">
                            {entry.final_total_earned}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
