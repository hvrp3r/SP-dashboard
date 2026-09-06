import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import * as sound from '../lib/sound.js';
import * as motusApi from '../api/motus.js';
import type {
  MotusAttempt,
  MotusAttemptHistoryEntry,
  MotusGame,
  MotusHistoryEntry,
  MotusLetterState,
  MotusQueueWord,
  MotusTodayAdminView,
  MotusWordSource,
} from '../types.js';

const LETTER_STYLE: Record<MotusLetterState, string> = {
  correct: 'bg-emerald-500 border-emerald-500 text-zinc-950',
  present: 'bg-amber-500 border-amber-500 text-zinc-950',
  absent: 'bg-zinc-800 border-zinc-700 text-zinc-400',
};

const SOURCE_LABEL: Record<MotusWordSource, string> = {
  queue: 'MSP',
  random: 'Auto',
  manual: 'Modifié',
};

function AttemptRow({ attempt, wordLength }: { attempt: MotusAttempt; wordLength: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${wordLength}, minmax(0, 1fr))` }}>
      {attempt.guess.split('').map((letter, i) => (
        <div
          key={i}
          className={`aspect-square rounded-md border-2 flex items-center justify-center font-bold text-lg uppercase ${LETTER_STYLE[attempt.result[i] as MotusLetterState]}`}
        >
          {letter}
        </div>
      ))}
    </div>
  );
}

function EmptyRow({ wordLength }: { wordLength: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${wordLength}, minmax(0, 1fr))` }}>
      {Array.from({ length: wordLength }, (_, i) => (
        <div key={i} className="aspect-square rounded-md border-2 border-zinc-800 bg-zinc-900/60" />
      ))}
    </div>
  );
}

export default function Motus() {
  const { user, setUser } = useAuth();
  const confirm = useConfirm();

  const [game, setGame] = useState<MotusGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guessInput, setGuessInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [queue, setQueue] = useState<MotusQueueWord[]>([]);
  const [history, setHistory] = useState<MotusHistoryEntry[]>([]);
  const [submissions, setSubmissions] = useState<MotusAttemptHistoryEntry[]>([]);
  const [todayAdmin, setTodayAdmin] = useState<MotusTodayAdminView | null>(null);
  const [newWord, setNewWord] = useState('');
  const [addingWord, setAddingWord] = useState(false);
  const [overrideWord, setOverrideWord] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [reorderingId, setReorderingId] = useState<number | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await motusApi.getToday();
      setGame(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadAdmin = useCallback(async () => {
    if (user?.role !== 'admin') return;
    try {
      const [pending, past, adminToday, recentSubmissions] = await Promise.all([
        motusApi.listQueue(),
        motusApi.listHistory(10),
        motusApi.getTodayAdmin(),
        motusApi.listAttempts(30),
      ]);
      setQueue(pending);
      setHistory(past);
      setTodayAdmin(adminToday);
      setSubmissions(recentSubmissions);
    } catch {
      // silencieux : section admin secondaire, ne bloque pas la partie du joueur
    }
  }, [user?.role]);

  useEffect(() => {
    loadAdmin();
  }, [loadAdmin]);

  async function handleGuess(e: FormEvent) {
    e.preventDefault();
    if (!game || !guessInput.trim()) return;
    sound.unlockAudio();
    setSubmitting(true);
    setError(null);
    try {
      const result = await motusApi.submitGuess(guessInput.trim());
      setGame(result);
      setGuessInput('');
      if (result.status === 'won') {
        sound.playWin();
        if (user) setUser({ ...user, sp_balance: user.sp_balance + result.rewardSp });
      } else if (result.status === 'lost') {
        sound.playLose();
      } else {
        sound.playChip();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
    // Une tentative vient d'être enregistrée : si l'utilisateur est MSP, son
    // panneau "Mot du jour" doit refléter le nouveau attemptCount (qui verrouille
    // l'édition dès la 1re tentative, la sienne y compris).
    await loadAdmin();
  }

  async function handleAddWord(e: FormEvent) {
    e.preventDefault();
    if (!newWord.trim()) return;
    setAddingWord(true);
    setAdminError(null);
    try {
      await motusApi.addQueueWord(newWord.trim());
      setNewWord('');
      await loadAdmin();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setAddingWord(false);
    }
  }

  async function handleRemoveWord(id: number) {
    const ok = await confirm('Retirer ce mot de la file ?');
    if (!ok) return;
    setAdminError(null);
    try {
      await motusApi.removeQueueWord(id);
      await loadAdmin();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }

  async function handleReorder(id: number, direction: 'up' | 'down') {
    setReorderingId(id);
    setAdminError(null);
    try {
      const updated = await motusApi.reorderQueueWord(id, direction);
      setQueue(updated);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setReorderingId(null);
    }
  }

  async function handleOverrideToday(e: FormEvent) {
    e.preventDefault();
    if (!overrideWord.trim()) return;
    setOverriding(true);
    setAdminError(null);
    try {
      await motusApi.overrideToday(overrideWord.trim());
      setOverrideWord('');
      // Le mot du jour vient de changer : la partie affichée (si l'admin y joue
      // aussi) et l'historique (qui référence encore l'ancien mot du jour)
      // doivent être rechargés.
      await Promise.all([load(), loadAdmin()]);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setOverriding(false);
    }
  }

  const attempts = game?.attempts ?? [];
  const remaining = game ? Math.max(0, game.maxAttempts - attempts.length) : 0;
  const gameOver = game && game.status !== 'in_progress';

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-zinc-50">Motus</h1>
          <VolumeSlider />
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          Un mot à trouver chaque jour — {game?.maxAttempts ?? '…'} tentatives, réinitialisé à minuit.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : game ? (
          <>
            <div className="space-y-1.5 mb-5">
              {attempts.map((a) => (
                <AttemptRow key={a.id} attempt={a} wordLength={game.wordLength} />
              ))}
              {!gameOver &&
                Array.from({ length: remaining }, (_, i) => (
                  <EmptyRow key={`empty-${i}`} wordLength={game.wordLength} />
                ))}
            </div>

            {game.status === 'in_progress' && (
              <form onSubmit={handleGuess} className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  maxLength={game.wordLength}
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  placeholder={`Mot de ${game.wordLength} lettres`}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 uppercase tracking-widest text-center font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  disabled={submitting || guessInput.length !== game.wordLength}
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? '…' : 'Valider'}
                </button>
              </form>
            )}

            {game.status === 'won' && (
              <p className="text-center text-emerald-400 font-semibold">
                🎉 Trouvé ! Le mot était <span className="uppercase">{game.word}</span> — +{game.rewardSp} SP
              </p>
            )}
            {game.status === 'lost' && (
              <p className="text-center text-red-400 font-semibold">
                Perdu — le mot était <span className="uppercase">{game.word}</span>
              </p>
            )}
          </>
        ) : null}

        {user?.role === 'admin' && (
          <div className="mt-10 pt-6 border-t border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">MSP — Mot du jour</h2>
            {adminError && <p className="mb-3 text-sm text-red-400">{adminError}</p>}

            {todayAdmin && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3 mb-6">
                <p className="text-xs text-zinc-500 mb-2">
                  Mot actuel :{' '}
                  <span className="text-zinc-200 font-semibold uppercase">{todayAdmin.word}</span>{' '}
                  <span className="text-zinc-600">({SOURCE_LABEL[todayAdmin.source]})</span>
                </p>
                {todayAdmin.attemptCount > 0 ? (
                  <p className="text-xs text-amber-400">
                    Verrouillé — {todayAdmin.attemptCount} tentative
                    {todayAdmin.attemptCount > 1 ? 's' : ''} déjà enregistrée
                    {todayAdmin.attemptCount > 1 ? 's' : ''} aujourd'hui.
                  </p>
                ) : (
                  <form onSubmit={handleOverrideToday} className="flex gap-2">
                    <input
                      type="text"
                      value={overrideWord}
                      onChange={(e) => setOverrideWord(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                      maxLength={12}
                      placeholder="Remplacer par..."
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={overriding || overrideWord.length < 3}
                      className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-3 py-2 rounded-md transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Modifier
                    </button>
                  </form>
                )}
              </div>
            )}

            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">MSP — Prochains mots</h2>

            <form onSubmit={handleAddWord} className="flex gap-2 mb-4">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                maxLength={12}
                placeholder="Ajouter un mot (3-12 lettres)"
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={addingWord || newWord.length < 3}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-2 rounded-md transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Ajouter
              </button>
            </form>

            {queue.length === 0 ? (
              <p className="text-sm text-zinc-500 mb-6">
                Aucun mot en file — un mot est tiré au hasard chaque jour tant que la file est vide.
              </p>
            ) : (
              <ul className="space-y-1.5 mb-6">
                {queue.map((q, i) => (
                  <li
                    key={q.id}
                    className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm"
                  >
                    <span className="text-zinc-300">
                      <span className="text-zinc-600 mr-2">#{i + 1}</span>
                      {q.word}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReorder(q.id, 'up')}
                        disabled={i === 0 || reorderingId === q.id}
                        aria-label="Monter"
                        className="text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReorder(q.id, 'down')}
                        disabled={i === queue.length - 1 || reorderingId === q.id}
                        aria-label="Descendre"
                        className="text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => handleRemoveWord(q.id)}
                        className="text-xs text-red-400 hover:text-red-300 font-medium ml-1"
                      >
                        Retirer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {history.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-zinc-300 uppercase mb-2">Historique</h3>
                <ul className="space-y-1 mb-6">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between text-xs text-zinc-500 px-1 py-1">
                      <span>{h.word_date}</span>
                      <span className="text-zinc-300 font-medium">{h.word}</span>
                      <span className="uppercase tracking-wide">{SOURCE_LABEL[h.source]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-2">
              MSP — Soumissions des joueurs
            </h2>
            {submissions.length === 0 ? (
              <p className="text-sm text-zinc-500">Aucune soumission pour le moment.</p>
            ) : (
              <ul className="space-y-1">
                {submissions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs"
                  >
                    <span className={s.is_correct ? 'text-emerald-400' : 'text-zinc-500'}>
                      {s.is_correct ? '✅' : '❌'}
                    </span>
                    <span className="text-zinc-200 font-medium flex-shrink-0">{s.username}</span>
                    <span className="text-zinc-400 uppercase tracking-widest flex-1 truncate">{s.guess}</span>
                    <span className="text-zinc-600 flex-shrink-0">#{s.attempt_number}</span>
                    <span className="text-zinc-600 flex-shrink-0">
                      {new Date(s.created_at).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
