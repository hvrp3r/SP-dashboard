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
  const [showClosed, setShowClosed] = useState(false);

  const [gameType, setGameType] = useState<MinigameGameType>(MINIGAME_GAME_TYPES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [entryFee, setEntryFee] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reward1st, setReward1st] = useState('');
  const [reward2nd, setReward2nd] = useState('');
  const [reward3rd, setReward3rd] = useState('');
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

  const openSessions = sessions.filter((s) => s.status === 'open');
  const closedSessions = sessions.filter((s) => s.status !== 'open');

  const showPaidOption = gameType === 'quiz';
  const paidFeeValue = showPaidOption && isPaid ? Number(entryFee) : NaN;
  const paidFeeInvalid = showPaidOption && isPaid && (!Number.isInteger(paidFeeValue) || paidFeeValue <= 0);

  const showFlappyBirdOptions = gameType === 'flappy_bird';
  const reward1stValue = Number(reward1st);
  const reward2ndValue = Number(reward2nd);
  const reward3rdValue = Number(reward3rd);
  const endsAtDate = endsAt ? new Date(endsAt) : null;
  const flappyBirdInvalid =
    showFlappyBirdOptions &&
    (!endsAtDate ||
      Number.isNaN(endsAtDate.getTime()) ||
      endsAtDate <= new Date() ||
      !Number.isInteger(reward1stValue) ||
      reward1stValue < 0 ||
      !Number.isInteger(reward2ndValue) ||
      reward2ndValue < 0 ||
      !Number.isInteger(reward3rdValue) ||
      reward3rdValue < 0);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (paidFeeInvalid) {
      setError('La mise doit être un entier positif');
      return;
    }
    if (flappyBirdInvalid) {
      setError('La date limite (dans le futur) et les 3 gains sont requis');
      return;
    }
    setSubmitting(true);
    try {
      await minigamesApi.createSession(
        gameType,
        title.trim(),
        description.trim() || undefined,
        showPaidOption && isPaid ? paidFeeValue : undefined,
        showFlappyBirdOptions
          ? {
              endsAt: new Date(endsAt).toISOString(),
              reward1st: reward1stValue,
              reward2nd: reward2ndValue,
              reward3rd: reward3rdValue,
            }
          : undefined
      );
      setTitle('');
      setDescription('');
      setIsPaid(false);
      setEntryFee('');
      setEndsAt('');
      setReward1st('');
      setReward2nd('');
      setReward3rd('');
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
                  if (nextType !== 'flappy_bird') {
                    setEndsAt('');
                    setReward1st('');
                    setReward2nd('');
                    setReward3rd('');
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
              {showFlappyBirdOptions && (
                <div className="space-y-2">
                  <label className="block text-xs text-zinc-500">Date limite</label>
                  <input
                    type="datetime-local"
                    required
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">1er (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward1st}
                        onChange={(e) => setReward1st(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">2e (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward2nd}
                        onChange={(e) => setReward2nd(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">3e (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward3rd}
                        onChange={(e) => setReward3rd(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={submitting || paidFeeInvalid || flappyBirdInvalid}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Créer
              </button>
            </form>
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            <div className="space-y-3">
              {openSessions.length === 0 ? (
                <p className="text-zinc-500">Aucun mini-jeu ouvert pour le moment.</p>
              ) : (
                openSessions.map((s) => <MinigameCard key={s.id} session={s} />)
              )}
            </div>

            {closedSessions.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowClosed((prev) => !prev)}
                  className="mb-3 text-sm text-zinc-400 hover:text-zinc-200 font-medium transition"
                >
                  {showClosed
                    ? 'Masquer les mini-jeux clôturés'
                    : `Voir les mini-jeux clôturés (${closedSessions.length})`}
                </button>
                {showClosed && (
                  <div className="space-y-3">
                    {closedSessions.map((s) => (
                      <MinigameCard key={s.id} session={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MinigameCard({ session: s }: { session: MinigameSession }) {
  return (
    <Link
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
          {s.game_type === 'flappy_bird' && s.reward_1st ? (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium uppercase tracking-wide">
              🥇 {s.reward_1st} SP
            </span>
          ) : null}
        </div>
        <span
          className={`flex-shrink-0 text-xs px-2 py-1 rounded-full ${
            s.status === 'open'
              ? 'bg-emerald-500/15 text-emerald-400'
              : s.status === 'cancelled'
                ? 'bg-red-500/15 text-red-400'
                : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {s.status === 'open' ? 'Ouvert' : s.status === 'cancelled' ? 'Annulé' : 'Clôturé'}
        </span>
      </div>
      {s.description && <p className="text-sm text-zinc-500">{s.description}</p>}
    </Link>
  );
}
