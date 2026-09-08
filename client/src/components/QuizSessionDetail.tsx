import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import Avatar from './Avatar.jsx';
import UserNameTag from './UserNameTag.jsx';
import VolumeSlider from './VolumeSlider.jsx';
import * as minigamesApi from '../api/minigames.js';
import * as leaderboardApi from '../api/leaderboard.js';
import * as sound from '../lib/sound.js';
import type { LeaderboardEntry, MinigameQuestionView, MinigameSessionDetail } from '../types.js';

const TICK_INTERVAL_MS = 1000;
/** Sous ce seuil (secondes restantes), la boucle de suspense bascule sur la variante plus intense. */
const QUIZ_LOOP_INTENSE_THRESHOLD_S = 10;

/** Compare une réponse à la réponse correcte saisie par le MSP (insensible à la casse/aux espaces). */
function matchesCorrectAnswer(correctAnswer: string | null | undefined, answerText: string | undefined): boolean {
  if (!correctAnswer || answerText === undefined) return false;
  return answerText.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
}

/**
 * Verdict final affiché pour une réponse : le rapprochement texte avec
 * `correct_answer` n'est qu'une première vérification indicative — dès que le
 * MSP a tranché manuellement (`marked_correct`), son verdict prime dessus.
 * Renvoie `null` quand il n'y a rien à afficher (pas de réponse, ou aucune
 * réponse correcte configurée et pas de verdict manuel).
 */
function effectiveCorrectness(
  correctAnswer: string | null | undefined,
  answer: { answer_text?: string; marked_correct?: boolean | null } | undefined
): boolean | null {
  if (!answer) return null;
  if (answer.marked_correct === true) return true;
  if (answer.marked_correct === false) return false;
  if (correctAnswer && answer.answer_text !== undefined) {
    return matchesCorrectAnswer(correctAnswer, answer.answer_text);
  }
  return null;
}

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
  const [durationSeconds, setDurationSeconds] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [awardAmounts, setAwardAmounts] = useState<Record<number, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const revealedRef = useRef(false);
  const introPlayedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    leaderboardApi
      .getLeaderboard('sp_balance')
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, [isAdmin]);

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, []);

  const participants = session.participants ?? [];
  const currentQuestion = session.currentQuestion ?? null;
  const myParticipant = participants.find((p) => p.user_id === userId);
  const myAnswer = currentQuestion?.answers.find((a) => a.user_id === userId);
  const pastQuestions = questions.filter((q) => q.id !== currentQuestion?.id);
  const availablePlayers = players.filter(
    (p) => !participants.some((part) => part.user_id === p.id)
  );

  const allAnswered =
    !!currentQuestion &&
    participants.length > 0 &&
    participants.every((p) => currentQuestion.answers.some((a) => a.user_id === p.user_id));
  const answersRevealed = currentQuestion?.status === 'closed' || allAnswered;

  // Le décompte s'arrête dès que les réponses sont révélées (plus personne à
  // attendre), même si la question reste "active" en base tant que le MSP ne
  // l'a pas explicitement clôturée — sinon le chrono continuait de défiler à
  // l'écran (et la musique de tension avec lui) après que tout le monde ait
  // déjà répondu.
  const remainingSeconds =
    currentQuestion?.status === 'active' && currentQuestion.ends_at && !answersRevealed
      ? Math.max(0, Math.ceil((new Date(currentQuestion.ends_at).getTime() - nowMs) / 1000))
      : null;

  // Sting d'intro une fois par question chronométrée, dès qu'elle démarre.
  useEffect(() => {
    if (
      currentQuestion?.status === 'active' &&
      currentQuestion.duration_seconds &&
      introPlayedRef.current !== currentQuestion.id
    ) {
      introPlayedRef.current = currentQuestion.id;
      sound.startQuizIntro();
    }
  }, [currentQuestion?.id, currentQuestion?.status, currentQuestion?.duration_seconds]);

  // La boucle part1 tourne tant que le timer avance ; elle ne bascule sur la
  // variante intense (part2) que sous le seuil automatique ou si le MSP l'a
  // déclenchée manuellement (`intense_at`, propagé à tous via le polling —
  // chacun joue sa propre musique localement, il n'y a pas de flux partagé).
  const hasCountdown = remainingSeconds !== null;
  const useIntensePhase =
    hasCountdown && (remainingSeconds! <= QUIZ_LOOP_INTENSE_THRESHOLD_S || !!currentQuestion?.intense_at);

  // Dépend de `hasCountdown`/`useIntensePhase` (des booléens qui ne changent
  // qu'à un vrai changement d'état : début/fin du timer, franchissement du
  // seuil) et surtout PAS de `remainingSeconds` lui-même, qui varie à chaque
  // tick d'horloge (chaque seconde) — sinon cet effet (et son nettoyage)
  // s'exécutait chaque seconde et relançait la piste depuis le début en
  // boucle, l'empêchant d'aller jusqu'au bout du fichier.
  useEffect(() => {
    if (hasCountdown) {
      sound.setQuizLoopPhase(useIntensePhase ? 'part2' : 'part1');
    } else {
      sound.stopQuizLoop();
    }
    return () => sound.stopQuizLoop();
  }, [hasCountdown, useIntensePhase]);

  // Établit l'état de référence dès qu'une nouvelle question apparaît, à la
  // valeur qu'elle a déjà à cet instant — pas toujours `false`. Sinon, arriver
  // sur la page (ou la recharger) alors que la dernière question est déjà
  // close jouait immédiatement le sting de révélation au montage : le sting
  // ne doit sonner que pour une transition observée EN DIRECT pendant qu'on
  // regarde, jamais rétroactivement pour un état déjà acquis avant l'arrivée.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    revealedRef.current = answersRevealed;
  }, [currentQuestion?.id]);

  // Sting de révélation une seule fois au moment où les réponses deviennent
  // visibles (réponses de tous reçues, timer écoulé, ou MSP a clôturé).
  useEffect(() => {
    if (answersRevealed && !revealedRef.current) {
      revealedRef.current = true;
      sound.playQuizAnswer();
    }
  }, [answersRevealed]);

  useEffect(() => {
    return () => sound.stopAllQuizAudio();
  }, []);

  async function handleJoin() {
    sound.unlockAudio();
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
    sound.unlockAudio();
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
    const trimmedDuration = durationSeconds.trim();
    const parsedDuration = trimmedDuration ? Number(trimmedDuration) : undefined;
    if (parsedDuration !== undefined && (!Number.isInteger(parsedDuration) || parsedDuration <= 0)) {
      onError('La durée doit être un entier positif de secondes');
      return;
    }
    sound.unlockAudio();
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.askQuestion(
        sessionId,
        prompt.trim(),
        parsedDuration,
        correctAnswer.trim() || undefined
      );
      onSessionChange(data);
      setPrompt('');
      setDurationSeconds('');
      setCorrectAnswer('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseQuestion() {
    if (!currentQuestion) return;
    sound.unlockAudio();
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

  async function handleIntensify() {
    if (!currentQuestion) return;
    sound.unlockAudio();
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.intensifyQuestion(sessionId, currentQuestion.id);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleGradeAnswer(targetUserId: number, correct: boolean) {
    if (!currentQuestion) return;
    const current = currentQuestion.answers.find((a) => a.user_id === targetUserId)?.marked_correct;
    // Recliquer sur le même verdict l'annule et retombe sur le rapprochement automatique.
    const next = current === correct ? null : correct;
    setBusy(true);
    onError(null);
    try {
      const data = await minigamesApi.gradeAnswer(sessionId, currentQuestion.id, targetUserId, next);
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
            <input
              type="number"
              min={1}
              max={3600}
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
              placeholder="Timer (s, optionnel)"
              title="Durée en secondes avant clôture automatique des réponses — laisser vide pour aucun timer"
              className="w-40 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="text"
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              placeholder="Bonne réponse (optionnel)"
              title="Affichée automatiquement à tous à la révélation des réponses — laisser vide pour ne rien afficher"
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
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-zinc-500 uppercase">
                {currentQuestion.status === 'active' ? 'Question en cours' : 'Dernière question'}
              </p>
              {remainingSeconds !== null && (
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                    remainingSeconds <= 5
                      ? 'bg-red-500/15 text-red-400'
                      : remainingSeconds <= 10
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  ⏱ {remainingSeconds}s
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <VolumeSlider />
              {isAdmin && remainingSeconds !== null && !useIntensePhase && (
                <button
                  onClick={handleIntensify}
                  disabled={busy}
                  title="Bascule la musique de tension en phase intense pour tous les joueurs, avant la fin du décompte"
                  className="text-sm bg-zinc-800 hover:bg-zinc-700 text-amber-400 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                >
                  🔥 Intensifier
                </button>
              )}
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
          </div>
          <p className="text-lg text-zinc-100 mb-2">{currentQuestion.prompt}</p>

          {currentQuestion.correct_answer && (
            <p className="text-sm text-emerald-400 mb-4">
              ✅ Bonne réponse : « {currentQuestion.correct_answer} »
            </p>
          )}

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
                const verdict = effectiveCorrectness(currentQuestion?.correct_answer, answer);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 text-sm"
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
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span className={verdict === null ? 'text-emerald-400' : verdict ? 'text-emerald-400' : 'text-red-400'}>
                          {verdict === null ? '✓' : verdict ? '✅' : '❌'} {answer.seconds_to_answer}s — « {answer.answer_text} »
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleGradeAnswer(p.user_id, true)}
                            disabled={busy}
                            title="Marquer correct"
                            className={`w-6 h-6 flex items-center justify-center rounded transition disabled:opacity-50 ${
                              answer.marked_correct === true
                                ? 'bg-emerald-500 text-zinc-950'
                                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                            }`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGradeAnswer(p.user_id, false)}
                            disabled={busy}
                            title="Marquer incorrect"
                            className={`w-6 h-6 flex items-center justify-center rounded transition disabled:opacity-50 ${
                              answer.marked_correct === false
                                ? 'bg-red-500 text-zinc-950'
                                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                            }`}
                          >
                            ✗
                          </button>
                        </span>
                      </span>
                    ) : (
                      <span className="text-zinc-500">en attente…</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isAdmin && answersRevealed && (
            <div className="space-y-2 mt-3">
              <p className="text-xs text-zinc-500 uppercase mb-1">Réponses des joueurs</p>
              {participants.map((p) => {
                const answer = currentQuestion?.answers.find((a) => a.user_id === p.user_id);
                const verdict = effectiveCorrectness(currentQuestion?.correct_answer, answer);
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
                      <span className={verdict === null ? 'text-emerald-400' : verdict ? 'text-emerald-400' : 'text-red-400'}>
                        {verdict === null ? '✓' : verdict ? '✅' : '❌'} {answer.seconds_to_answer}s
                        {answer.answer_text ? ` — « ${answer.answer_text} »` : ''}
                      </span>
                    ) : (
                      <span className="text-zinc-500">n'a pas répondu</span>
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
                          <UserNameTag username={p.username} />
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
                <p className="text-zinc-100 mb-1">{q.prompt}</p>
                {q.correct_answer && (
                  <p className="text-xs text-emerald-400 mb-2">
                    ✅ Bonne réponse : « {q.correct_answer} »
                  </p>
                )}
                {q.answers.length === 0 ? (
                  <p className="text-sm text-zinc-500">Personne n'a répondu.</p>
                ) : (
                  <ul className="space-y-1">
                    {q.answers.map((a) => {
                      const isCorrect = effectiveCorrectness(q.correct_answer, a);
                      return (
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
                          <span className={isCorrect === null ? 'text-zinc-500' : isCorrect ? 'text-emerald-400' : 'text-red-400'}>
                            {isCorrect !== null && (isCorrect ? '✅ ' : '❌ ')}
                            {a.seconds_to_answer}s
                            {a.answer_text ? ` — « ${a.answer_text} »` : ''}
                          </span>
                        </li>
                      );
                    })}
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
