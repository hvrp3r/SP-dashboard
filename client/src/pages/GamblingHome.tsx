import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as gamblingApi from '../api/gambling.js';
import type { GamblingGameInfo } from '../types.js';

export default function GamblingHome() {
  const [games, setGames] = useState<GamblingGameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gamblingApi
      .listGames()
      .then(setGames)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'))
      .finally(() => setLoading(false));
  }, []);

  const activeGames = games.filter((g) => g.enabled);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Gambling</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : activeGames.length === 0 ? (
          <p className="text-zinc-500">Aucun jeu de gambling actif pour le moment.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeGames.map((g) => (
              <Link
                key={g.id}
                to={g.path}
                className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-5 hover:border-emerald-500/50 transition"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-semibold text-zinc-100">{g.name}</p>
                  {g.rtp !== null && (
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                      {g.rtp}% redistribués
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500">{g.description}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
