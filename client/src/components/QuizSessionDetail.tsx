import { useEffect, useState, type FormEvent } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import Avatar from './Avatar.jsx';
import UserNameTag from './UserNameTag.jsx';
import * as minigamesApi from '../api/minigames.js';
import * as leaderboardApi from '../api/leaderboard.js';
import type { LeaderboardEntry, MinigameQuestionView, MinigameSessionDetail } from '../types.js';

interface Props {
  sessionId: number;
  session: MinigameSessionDetail;
  questions: MinigameQuestionView[];
  isAdmin: boolean;
  userId: number | undefined;
  onSessionChange: (session: MinigameSessionDetail) => void;
  onError: (message: string | null) => void;
}

export default function QuizSessionDetail({
  sessionId,
  session,
  questions,
  isAdmin,
  userId,
  onSessionChange,
  onError,
}: Props) {
  const confirm = useConfirm();

  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [joining, setJoining] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [busy, setBusy] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [awardAmounts, setAwardAmounts] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!isAdmin) return;
    leaderboardApi
      .getLeaderboard('sp_balance')
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, [isAdmin]);

  const participants = session.participants ?? [];
  const currentQuestion = session.currentQuestion ?? null;
  const myParticipant = participants.find((p) => p.user_id === userId);
  const myAnswer = currentQuestion?.answers.find((a) => a.user_id === userId);
  const pastQuestions = questions.filter((q) => q.id !== currentQuestion?.id);
  const availablePlayers = players.filter(
    (p) => !participants.some((part) => part.user_id === p.id)
  );

  async function handleJoin() {
    setJoining(true);
    onError(null);
    try {
      const data = await minigamesApi.joinSession(sessionId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setJoining(false);
    }
  }

  async function handleSubmitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!currentQuestion || !answerText.trim()) return;
    setSubmitting(true);
    onError(null);
    try {
      const data = await minigamesApi.submitAnswer(sessionId, currentQuestion.id, answerText.trim());
      onSessionChange(data);
      setAnswerText('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddParticipant() {
    if (!selectedPlayerId) return;
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.addParticipant(sessionId, Number(selectedPlayerId));
      onSessionChange(data);
      setSelectedPlayerId('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveParticipant(participantId: number) {
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.removeParticipant(sessionId, participantId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleAskQuestion(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.askQuestion(sessionId, prompt.trim());
      onSessionChange(data);
      setPrompt('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseQuestion() {
    if (!currentQuestion) return;
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.closeQuestion(sessionId, currentQuestion.id);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
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
    onError(null);
    try {
      const data = await minigamesApi.awardParticipants(sessionId, awards);
      onSessionChange(data);
      setAwardAmounts({});
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
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
    onError(null);
    try {
      const data = await minigamesApi.closeSession(sessionId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!myParticipant && session.status === 'open' && (
        <button
          onClick={handleJoin}
          disabled={joining}
          className="mb-6 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
        >
          {joining
            ? 'Inscription…'
            : session.entry_fee
              ? `Rejoindre le mini-jeu (-${session.entry_fee} SP)`
              : 'Rejoindre le mini-jeu'}
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
          {currentQuestion?.status === 'active' && (
            <p className="text-xs text-zinc-500 mt-2">
              Diffuser une nouvelle question clôture automatiquement la question en cours.
            </p>
          )}
        </div>
      )}

      {currentQuestion ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-zinc-500 uppercase">
              {currentQuestion.status === 'active' ? 'Question en cours' : 'Dernière question'}
            </p>
            {isAdmin && currentQuestion.status === 'active' && (
              <button
                onClick={handleCloseQuestion}
                disabled={busy}
                className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-md transition disabled:opacity-50"
              >
                Clôturer les réponses
              </button>
            )}
          </div>
          <p className="text-lg text-zinc-100 mb-4">{currentQuestion.prompt}</p>

          {myParticipant && currentQuestion.status === 'active' && !myAnswer && (
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
              {participants.map((p) => {
                const answer = currentQuestion?.answers.find((a) => a.user_id === p.user_id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Avatar
                        username={p.username}
                        avatarUrl={p.avatar_url}
                        size={20}
                        frameUrl={p.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                      />
                      <UserNameTag username={p.username} equipped={p.equipped_cosmetics} className="text-zinc-200" />
                    </span>
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
          {participants.length === 0 ? (
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
                  {participants.map((p) => (
                    <tr key={p.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Avatar
                            username={p.username}
                            avatarUrl={p.avatar_url}
                            size={20}
                            frameUrl={p.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                          />
                          <UserNameTag username={p.username} equipped={p.equipped_cosmetics} className="text-zinc-100" />
                        </span>
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
          {participants.length === 0 ? (
            <p className="p-6 text-center text-zinc-500">Aucun participant pour l'instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Joueur</th>
                    <th className="px-4 py-3 text-right">
                      {currentQuestion ? 'Statut' : 'SP gagnés'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => {
                    const answer = currentQuestion?.answers.find((a) => a.user_id === p.user_id);
                    return (
                      <tr key={p.id} className="border-t border-zinc-800">
                        <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">
                          {p.username}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {currentQuestion ? (
                            answer ? (
                              <span className="text-emerald-400 font-medium">
                                ✓ {answer.seconds_to_answer}s
                              </span>
                            ) : (
                              <span className="text-zinc-500">en attente…</span>
                            )
                          ) : p.sp_awarded > 0 ? (
                            <span className="text-emerald-400 font-bold">+{p.sp_awarded}</span>
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
              <div key={q.id} className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4">
                <p className="text-zinc-100 mb-2">{q.prompt}</p>
                {q.answers.length === 0 ? (
                  <p className="text-sm text-zinc-500">Personne n'a répondu.</p>
                ) : (
                  <ul className="space-y-1">
                    {q.answers.map((a) => (
                      <li key={a.user_id} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Avatar
                            username={a.username}
                            avatarUrl={a.avatar_url}
                            size={18}
                            frameUrl={a.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                          />
                          <UserNameTag username={a.username} equipped={a.equipped_cosmetics} className="text-zinc-300" />
                        </span>
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
  );
}
