import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as battleApi from '../api/gamblingBattles.js';
import * as gamblingApi from '../api/gambling.js';
import * as sound from '../lib/sound.js';
import CrateIcon from '../components/CrateIcon.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import type { GamblingBattleListEntry, GamblingBattleStatus, GamblingCrateEntry } from '../types.js';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const POLL_INTERVAL_MS = 4000;

function statusLabel(status: GamblingBattleStatus): { label: string; className: string } {
  switch (status) {
    case 'waiting':
      return { label: 'En attente de joueurs', className: 'bg-amber-500/15 text-amber-400' };
    case 'in_progress':
      return { label: 'En cours', className: 'bg-emerald-500/15 text-emerald-400' };
    case 'completed':
      return { label: 'Terminée', className: 'bg-zinc-800 text-zinc-400' };
    default:
      return { label: 'Annulée', className: 'bg-red-500/15 text-red-400' };
  }
}

export default function GamblingBattles() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [battles, setBattles] = useState<GamblingBattleListEntry[]>([]);
  const [history, setHistory] = useState<GamblingBattleListEntry[]>([]);
  const [crates, setCrates] = useState<GamblingCrateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCrateIds, setSelectedCrateIds] = useState<number[]>([]);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<number | null>(null);

  const loadBattles = useCallback(() => {
    battleApi
      .listBattles()
      .then(setBattles)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'));
  }, []);

  useEffect(() => {
    loadBattles();
    const interval = setInterval(loadBattles, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadBattles]);

  useEffect(() => {
    battleApi
      .listHistory(10)
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    gamblingApi
      .listCrates()
      .then(setCrates)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'))
      .finally(() => setLoading(false));
  }, []);

  function addCrate(crateId: number) {
    setSelectedCrateIds((prev) => [...prev, crateId]);
  }

  function removeCrateAt(index: number) {
    setSelectedCrateIds((prev) => prev.filter((_, i) => i !== index));
  }

  const totalCost = selectedCrateIds.reduce(
    (sum, id) => sum + (crates.find((c) => c.id === id)?.cost_sp ?? 0),
    0
  );

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (selectedCrateIds.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await battleApi.createBattle({ crateIds: selectedCrateIds, maxPlayers });
      if (user) setUser({ ...user, sp_balance: result.balance });
      navigate(`/gambling/battles/${result.battle.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(battleId: number) {
    sound.unlockAudio();
    setJoiningId(battleId);
    setError(null);
    try {
      const result = await battleApi.joinBattle(battleId);
      if (user) setUser({ ...user, sp_balance: result.balance });
      navigate(`/gambling/battles/${battleId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/gambling" className="text-sm text-emerald-400 font-medium">
          ← Jeux
        </Link>
        <h1 className="text-2xl font-bold text-zinc-50 mt-4 mb-2">Case Battle</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Choisis des caisses, invite des joueurs — celui qui tire le plus de SP au total rafle
          l'intégralité des gains (SP et cosmétiques) de tout le monde.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <form
          onSubmit={handleCreate}
          className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-6"
        >
          <p className="text-sm font-medium text-zinc-200 mb-2">Créer une bataille</p>

          {selectedCrateIds.length > 0 && (
            <ul className="space-y-1 mb-3">
              {selectedCrateIds.map((id, i) => {
                const crate = crates.find((c) => c.id === id);
                return (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-sm bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5"
                  >
                    <CrateIcon imageUrl={crate?.image_url ?? null} size={24} />
                    <span className="flex-1 text-zinc-200 truncate">{crate?.name ?? '…'}</span>
                    <span className="text-zinc-500 flex-shrink-0">{crate?.cost_sp ?? 0} SP</span>
                    <button
                      type="button"
                      onClick={() => removeCrateAt(i)}
                      className="text-red-400 text-xs hover:underline flex-shrink-0"
                    >
                      Retirer
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <select
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) addCrate(id);
              e.target.value = '';
            }}
            className="w-full mb-3 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            defaultValue=""
          >
            <option value="">+ Ajouter une caisse…</option>
            {crates
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.cost_sp > 0 ? `${c.cost_sp} SP` : 'Gratuite'}
                </option>
              ))}
          </select>

          <div className="flex items-center gap-3 mb-3">
            <label className="text-sm text-zinc-400">Joueurs max</label>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="ml-auto text-sm text-zinc-400">
              Coût d'entrée : <span className="text-zinc-100 font-semibold">{totalCost} SP</span>
            </span>
          </div>

          <button
            type="submit"
            disabled={creating || selectedCrateIds.length === 0 || (user?.sp_balance ?? 0) < totalCost}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2.5 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? 'Création…' : 'Créer la bataille'}
          </button>
          {selectedCrateIds.length > 0 && (user?.sp_balance ?? 0) < totalCost && (
            <p className="text-xs text-red-400 mt-2">Solde SP insuffisant.</p>
          )}
        </form>

        <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">Batailles en cours</h2>
        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : battles.length === 0 ? (
          <p className="text-sm text-zinc-500 mb-6">Aucune bataille en cours. Lance-en une !</p>
        ) : (
          <ul className="space-y-2 mb-6">
            {battles.map((b) => {
              const status = statusLabel(b.status);
              return (
                <li key={b.id} className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-sm text-zinc-400">
                      {b.participantCount}/{b.max_players} joueurs
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    {b.crates.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-md pl-1 pr-2 py-1 text-xs text-zinc-300"
                      >
                        <CrateIcon imageUrl={c.crate_image_url} size={20} />
                        {c.crate_name}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-500 mb-3">{b.cost_sp} SP l'entrée</p>
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/gambling/battles/${b.id}`}
                      className="text-sm text-emerald-400 font-medium hover:underline"
                    >
                      Voir →
                    </Link>
                    {b.status === 'waiting' && (
                      <button
                        onClick={() => handleJoin(b.id)}
                        disabled={joiningId === b.id}
                        className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                      >
                        {joiningId === b.id ? 'Entrée…' : 'Rejoindre'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {history.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">Historique</h2>
            <ul className="space-y-2">
              {history.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {b.winners[0] && (
                      <Avatar
                        username={b.winners[0].username}
                        avatarUrl={b.winners[0].avatar_url}
                        size={24}
                        frameUrl={b.winners[0].equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                      />
                    )}
                    <div className="min-w-0">
                      {b.winners.length > 0 ? (
                        <p className="truncate">
                          <UserNameTag
                            username={b.winners[0]?.username ?? '?'}
                            equipped={b.winners[0]?.equipped_cosmetics ?? []}
                            className="text-zinc-300"
                          />
                          {b.winners.length > 1 && (
                            <span className="text-zinc-500"> +{b.winners.length - 1}</span>
                          )}
                        </p>
                      ) : (
                        <p className="text-zinc-500">Personne</p>
                      )}
                      <p className="text-xs text-zinc-500">
                        {b.participantCount} joueurs · {b.cost_sp} SP l'entrée
                      </p>
                    </div>
                  </div>
                  <Link
                    to={`/gambling/battles/${b.id}`}
                    className="text-emerald-400 text-xs font-medium hover:underline flex-shrink-0"
                  >
                    Revoir
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
