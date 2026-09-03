import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as minigamesApi from '../api/minigames.js';
import { GAME_TYPE_LABELS, gameTypeLabel } from '../lib/minigameLabels.js';
import { MINIGAME_GAME_TYPES, type MinigameGameType, type MinigameSession } from '../types.js';

export default function Minigames() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [sessions, setSessions] = useState<MinigameSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gameType, setGameType] = useState<MinigameGameType>(MINIGAME_GAME_TYPES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [entryFee, setEntryFee] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await minigamesApi.listSessions();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const showPaidOption = gameType === 'quiz';
  const paidFeeValue = showPaidOption && isPaid ? Number(entryFee) : NaN;
  const paidFeeInvalid = showPaidOption && isPaid && (!Number.isInteger(paidFeeValue) || paidFeeValue <= 0);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (paidFeeInvalid) {
      setError('La mise doit être un entier positif');
      return;
    }
    setSubmitting(true);
    try {
      await minigamesApi.createSession(
        gameType,
        title.trim(),
        description.trim() || undefined,
        showPaidOption && isPaid ? paidFeeValue : undefined
      );
      setTitle('');
      setDescription('');
      setIsPaid(false);
      setEntryFee('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Mini-jeux</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {isAdmin && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
            <h2 className="font-semibold text-zinc-200 mb-3">Créer une session</h2>
            <form onSubmit={handleCreate} className="space-y-2">
              <select
                value={gameType}
                onChange={(e) => {
                  const nextType = e.target.value as MinigameGameType;
                  setGameType(nextType);
                  if (nextType !== 'quiz') {
                    setIsPaid(false);
                    setEntryFee('');
                  }
                }}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {MINIGAME_GAME_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {GAME_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                maxLength={255}
                placeholder="Titre (ex: Quiz Culture Générale #3)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <textarea
                placeholder="Description (optionnel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {showPaidOption && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={isPaid}
                      onChange={(e) => setIsPaid(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                    />
                    Payant
                  </label>
                  {isPaid && (
                    <input
                      type="number"
                      required
                      min={1}
                      step={1}
                      placeholder="Mise pour accéder au quiz (SP)"
                      value={entryFee}
                      onChange={(e) => setEntryFee(e.target.value)}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  )}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting || paidFeeInvalid}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Créer
              </button>
            </form>
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            <p className="text-zinc-500">Chargement…</p>
          ) : sessions.length === 0 ? (
            <p className="text-zinc-500">Aucun mini-jeu pour le moment.</p>
          ) : (
            sessions.map((s) => (
              <Link
                key={s.id}
                to={`/mini-jeux/${s.id}`}
                className="block bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 hover:border-emerald-500/50 transition"
              >
                <div className="flex items-center justify-between mb-1 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-medium text-zinc-100 truncate">{s.title}</p>
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
                      {gameTypeLabel(s.game_type)}
                    </span>
                    {s.entry_fee && (
                      <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium uppercase tracking-wide">
                        {s.entry_fee} SP
                      </span>
                    )}
                  </div>
                  <span
                    className={`flex-shrink-0 text-xs px-2 py-1 rounded-full ${
                      s.status === 'open'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {s.status === 'open' ? 'Ouvert' : 'Clôturé'}
                  </span>
                </div>
                {s.description && <p className="text-sm text-zinc-500">{s.description}</p>}
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
