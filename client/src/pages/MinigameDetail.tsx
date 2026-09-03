import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import * as minigamesApi from '../api/minigames.js';
import * as leaderboardApi from '../api/leaderboard.js';
import { gameTypeLabel } from '../lib/minigameLabels.js';
import type { LeaderboardEntry, MinigameQuestionView, MinigameSessionDetail } from '../types.js';

const POLL_INTERVAL_MS = 2000;

export default function MinigameDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const { user } = useAuth();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'admin';

  const [session, setSession] = useState<MinigameSessionDetail | null>(null);
  const [questions, setQuestions] = useState<MinigameQuestionView[]>([]);
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [joining, setJoining] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [busy, setBusy] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [awardAmounts, setAwardAmounts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const [data, history] = await Promise.all([
        minigamesApi.getSession(sessionId),
        minigamesApi.listQuestions(sessionId),
      ]);
      setSession(data);
      setQuestions(history);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    leaderboardApi
      .getLeaderboard('sp_balance')
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, [isAdmin]);

  useEffect(() => {
    if (!session || session.status !== 'open') return;
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      const data = await minigamesApi.joinSession(sessionId);
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setJoining(false);
    }
  }

  async function handleSubmitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!session?.currentQuestion || !answerText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await minigamesApi.submitAnswer(
        sessionId,
        session.currentQuestion.id,
        answerText.trim()
      );
      setSession(data);
      setAnswerText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddParticipant() {
    if (!selectedPlayerId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await minigamesApi.addParticipant(sessionId, Number(selectedPlayerId));
      setSession(data);
      setSelectedPlayerId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveParticipant(participantId: number) {
    setBusy(true);
    setError(null);
    try {
      const data = await minigamesApi.removeParticipant(sessionId, participantId);
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleAskQuestion(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await minigamesApi.askQuestion(sessionId, prompt.trim());
      setSession(data);
      setPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseQuestion() {
    if (!session?.currentQuestion) return;
    setBusy(true);
    setError(null);
    try {
      const data = await minigamesApi.closeQuestion(sessionId, session.currentQuestion.id);
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleAward(e: FormEvent) {
    e.preventDefault();
    const awards = Object.entries(awardAmounts)
      .map(([participantId, value]) => ({
        participantId: Number(participantId),
        amount: Number(value),
      }))
      .filter((a) => Number.isInteger(a.amount) && a.amount > 0);
    if (awards.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const data = await minigamesApi.awardParticipants(sessionId, awards);
      setSession(data);
      setAwardAmounts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseSession() {
    const ok = await confirm({
      title: 'Clôturer la session',
      message: 'Plus aucune question ne pourra être posée.',
      confirmLabel: 'Clôturer',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const data = await minigamesApi.closeSession(sessionId);
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  const myParticipant = session?.participants.find((p) => p.user_id === user?.id);
  const myAnswer = session?.currentQuestion?.answers.find((a) => a.user_id === user?.id);
  const pastQuestions = questions.filter((q) => q.id !== session?.currentQuestion?.id);
  const availablePlayers = players.filter(
    (p) => !session?.participants.some((part) => part.user_id === p.id)
  );

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/mini-jeux" className="text-sm text-emerald-400 font-medium">
          ← Mini-jeux
        </Link>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="mt-4 text-zinc-500">Chargement…</p>
        ) : !session ? (
          <p className="mt-4 text-zinc-500">Session introuvable.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mt-4 mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-2xl font-bold text-zinc-50 truncate">{session.title}</h1>
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
                  {gameTypeLabel(session.game_type)}
                </span>
              </div>
              <span
                className={`flex-shrink-0 text-xs px-2 py-1 rounded-full ${
                  session.status === 'open'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {session.status === 'open' ? 'Ouvert' : 'Clôturé'}
              </span>
            </div>
            {session.description && (
              <p className="text-sm text-zinc-400 mb-4">{session.description}</p>
            )}

            {!myParticipant && session.status === 'open' && (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="mb-6 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                {joining ? 'Inscription…' : 'Rejoindre le mini-jeu'}
              </button>
            )}

            {isAdmin && session.status === 'open' && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
                <h2 className="font-semibold text-zinc-200 mb-3">Ajouter un participant</h2>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={selectedPlayerId}
                    onChange={(e) => setSelectedPlayerId(e.target.value)}
                    className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Choisir un joueur</option>
                    {availablePlayers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.username}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddParticipant}
                    disabled={busy || !selectedPlayerId}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
                  >
                    Ajouter
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Les joueurs peuvent aussi rejoindre eux-mêmes depuis cette page.
                </p>
              </div>
            )}

            {isAdmin && session.status === 'open' && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
                <h2 className="font-semibold text-zinc-200 mb-3">Poser une question</h2>
                <form onSubmit={handleAskQuestion} className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    required
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Question à afficher aux joueurs"
                    className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
                  >
                    Diffuser
                  </button>
                </form>
                {session.currentQuestion?.status === 'active' && (
                  <p className="text-xs text-zinc-500 mt-2">
                    Diffuser une nouvelle question clôture automatiquement la question en cours.
                  </p>
                )}
              </div>
            )}

            {session.currentQuestion ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-zinc-500 uppercase">
                    {session.currentQuestion.status === 'active'
                      ? 'Question en cours'
                      : 'Dernière question'}
                  </p>
                  {isAdmin && session.currentQuestion.status === 'active' && (
                    <button
                      onClick={handleCloseQuestion}
                      disabled={busy}
                      className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                    >
                      Clôturer les réponses
                    </button>
                  )}
                </div>
                <p className="text-lg text-zinc-100 mb-4">{session.currentQuestion.prompt}</p>

                {myParticipant && session.currentQuestion.status === 'active' && !myAnswer && (
                  <form onSubmit={handleSubmitAnswer} className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      required
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="Ta réponse"
                      className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
                    >
                      Valider
                    </button>
                  </form>
                )}

                {myAnswer?.answer_text && (
                  <p className="text-sm text-emerald-400">
                    Tu as répondu en {myAnswer.seconds_to_answer}s : « {myAnswer.answer_text} »
                  </p>
                )}

                {!myParticipant && !isAdmin && (
                  <p className="text-sm text-zinc-500">Rejoins le mini-jeu pour répondre.</p>
                )}

                {isAdmin && (
                  <div className="space-y-2 mt-3">
                    {session.participants.map((p) => {
                      const answer = session.currentQuestion?.answers.find(
                        (a) => a.user_id === p.user_id
                      );
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2 text-sm"
                        >
                          <span className="text-zinc-200">{p.username}</span>
                          {answer ? (
                            <span className="text-emerald-400">
                              ✓ {answer.seconds_to_answer}s — « {answer.answer_text} »
                            </span>
                          ) : (
                            <span className="text-zinc-500">en attente…</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              session.status === 'open' && (
                <p className="text-zinc-500 mb-6">En attente d'une question du MSP…</p>
              )
            )}

            {isAdmin ? (
              <form
                onSubmit={handleAward}
                className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-6"
              >
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="font-semibold text-zinc-200">Attribuer les SP</h2>
                  <button
                    type="submit"
                    disabled={busy}
                    className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                  >
                    Attribuer
                  </button>
                </div>
                {session.participants.length === 0 ? (
                  <p className="p-6 text-center text-zinc-500">Aucun participant.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                        <tr>
                          <th className="px-4 py-3 text-left">Joueur</th>
                          <th className="px-4 py-3 text-right">Déjà reçu</th>
                          <th className="px-4 py-3 text-right">Attribuer</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.participants.map((p) => (
                          <tr key={p.id} className="border-t border-zinc-800">
                            <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">
                              {p.username}
                            </td>
                            <td className="px-4 py-3 text-right text-emerald-400 font-bold whitespace-nowrap">
                              {p.sp_awarded > 0 ? `+${p.sp_awarded}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                min={0}
                                value={awardAmounts[p.id] ?? ''}
                                onChange={(e) =>
                                  setAwardAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                disabled={session.status !== 'open'}
                                className="w-20 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                              />
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {!p.awarded_at && session.status === 'open' && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveParticipant(p.id)}
                                  disabled={busy}
                                  className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                                >
                                  Retirer
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </form>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-6">
                {session.participants.length === 0 ? (
                  <p className="p-6 text-center text-zinc-500">Aucun participant pour l'instant.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                        <tr>
                          <th className="px-4 py-3 text-left">Joueur</th>
                          <th className="px-4 py-3 text-right">
                            {session.currentQuestion ? 'Statut' : 'SP gagnés'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.participants.map((p) => {
                          const answer = session.currentQuestion?.answers.find(
                            (a) => a.user_id === p.user_id
                          );
                          return (
                            <tr key={p.id} className="border-t border-zinc-800">
                              <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">
                                {p.username}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {session.currentQuestion ? (
                                  answer ? (
                                    <span className="text-emerald-400 font-medium">
                                      ✓ {answer.seconds_to_answer}s
                                    </span>
                                  ) : (
                                    <span className="text-zinc-500">en attente…</span>
                                  )
                                ) : p.sp_awarded > 0 ? (
                                  <span className="text-emerald-400 font-bold">
                                    +{p.sp_awarded}
                                  </span>
                                ) : (
                                  <span className="text-zinc-500">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {isAdmin && session.status === 'open' && (
              <button
                onClick={handleCloseSession}
                disabled={busy}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50 mb-6"
              >
                Clôturer la session
              </button>
            )}

            {pastQuestions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
                  Historique des questions
                </h2>
                <div className="space-y-3">
                  {pastQuestions.map((q) => (
                    <div
                      key={q.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4"
                    >
                      <p className="text-zinc-100 mb-2">{q.prompt}</p>
                      {q.answers.length === 0 ? (
                        <p className="text-sm text-zinc-500">Personne n'a répondu.</p>
                      ) : (
                        <ul className="space-y-1">
                          {q.answers.map((a) => (
                            <li
                              key={a.user_id}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-zinc-300">{a.username}</span>
                              <span className="text-zinc-500">
                                {a.seconds_to_answer}s
                                {a.answer_text ? ` — « ${a.answer_text} »` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
