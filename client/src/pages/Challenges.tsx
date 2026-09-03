import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import * as challengesApi from '../api/challenges.js';
import * as leaderboardApi from '../api/leaderboard.js';
import type {
  Challenge,
  ChallengeParticipant,
  ChallengeQuota,
  ChallengeStatus,
  LeaderboardEntry,
} from '../types.js';

const STATUS_LABELS: Record<ChallengeStatus, string> = {
  pending: 'En attente',
  accepted: 'En cours',
  declined: 'Déclinée',
  expired: 'Expirée',
  resolved: 'Terminée',
  cancelled: 'Annulée',
};

const PARTICIPANT_STATUS_LABELS: Record<ChallengeParticipant['status'], string> = {
  pending: 'en attente',
  accepted: 'accepté',
  declined: 'décliné',
};

const ACTIVE_STATUSES: ChallengeStatus[] = ['pending', 'accepted'];

const POLL_INTERVAL_MS = 5000;

export default function Challenges() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [quota, setQuota] = useState<ChallengeQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  const [opponentIds, setOpponentIds] = useState<number[]>([]);
  const [wager, setWager] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);

  async function loadChallenges() {
    try {
      const data = await challengesApi.listMyChallenges();
      setChallenges(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  function loadQuota() {
    challengesApi.getStatus().then(setQuota).catch(() => {});
  }

  useEffect(() => {
    loadChallenges();
    loadQuota();
    leaderboardApi
      .getLeaderboard('sp_balance')
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, []);

  useEffect(() => {
    const interval = setInterval(loadChallenges, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const opponents = players.filter((p) => p.id !== user?.id);
  const quotaReached = quota !== null && quota.countToday >= quota.maxPerDay;

  function toggleOpponent(id: number) {
    setOpponentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (opponentIds.length === 0 || !wager || quotaReached) return;
    setError(null);
    setSubmitting(true);
    try {
      await challengesApi.createChallenge(opponentIds, Number(wager), description.trim() || undefined);
      setWager('');
      setOpponentIds([]);
      setDescription('');
      await loadChallenges();
      loadQuota();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(id: number, action: () => Promise<unknown>) {
    setError(null);
    setActingId(id);
    try {
      await action();
      await loadChallenges();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setActingId(null);
    }
  }

  if (!user) return null;

  const activeChallenges = challenges.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const finishedChallenges = challenges.filter((c) => !ACTIVE_STATUSES.includes(c.status));

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Défis</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold text-zinc-200">Lancer un défi</h2>
            {quota && (
              <span
                className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                  quotaReached ? 'bg-red-500/15 text-red-400' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {quota.countToday}/{quota.maxPerDay} défis lancés aujourd'hui
              </span>
            )}
          </div>
          <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
            <div className="w-full">
              <span className="text-sm text-zinc-400">
                Adversaire{opponentIds.length > 1 ? 's' : ''}
                {opponentIds.length > 0 && (
                  <span className="text-zinc-500"> ({opponentIds.length} sélectionné{opponentIds.length > 1 ? 's' : ''})</span>
                )}
              </span>
              <div className="mt-1 flex flex-wrap gap-2">
                {opponents.length === 0 ? (
                  <p className="text-sm text-zinc-500">Aucun autre joueur pour le moment.</p>
                ) : (
                  opponents.map((p) => {
                    const selected = opponentIds.includes(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => toggleOpponent(p.id)}
                        aria-pressed={selected}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150 transform hover:scale-105 active:scale-95 ${
                          selected
                            ? 'bg-emerald-500 text-zinc-950'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {p.username}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <input
              type="number"
              min={1}
              required
              placeholder="Mise (SP)"
              value={wager}
              onChange={(e) => setWager(e.target.value)}
              className="w-32 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="text"
              maxLength={500}
              placeholder="Description (optionnel)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              disabled={submitting || opponentIds.length === 0 || quotaReached}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              Défier{opponentIds.length > 1 ? ` (${opponentIds.length})` : ''}
            </button>
          </form>
          {quotaReached && (
            <p className="mt-2 text-xs text-red-400">
              Limite de {quota?.maxPerDay} défis par jour atteinte — reviens demain.
            </p>
          )}
          {!quotaReached && opponentIds.length > 1 && wager && (
            <p className="mt-2 text-xs text-zinc-500">
              Chacun mise {wager} SP · le gagnant remporte le pot entier (
              {Number(wager) * (opponentIds.length + 1)} SP si tout le monde accepte)
            </p>
          )}
        </div>

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            <div className="space-y-3">
              {activeChallenges.length === 0 ? (
                <p className="text-zinc-500">Aucun défi en cours.</p>
              ) : (
                activeChallenges.map((c) => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    userId={user.id}
                    actingId={actingId}
                    runAction={runAction}
                  />
                ))
              )}
            </div>

            {finishedChallenges.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowFinished((prev) => !prev)}
                  className="mb-3 text-sm text-zinc-400 hover:text-zinc-200 font-medium transition"
                >
                  {showFinished
                    ? 'Masquer les défis terminés'
                    : `Voir les défis terminés ou annulés (${finishedChallenges.length})`}
                </button>
                {showFinished && (
                  <div className="space-y-3">
                    {finishedChallenges.map((c) => (
                      <ChallengeCard
                        key={c.id}
                        challenge={c}
                        userId={user.id}
                        actingId={actingId}
                        runAction={runAction}
                      />
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

function ChallengeCard({
  challenge: c,
  userId,
  actingId,
  runAction,
}: {
  challenge: Challenge;
  userId: number;
  actingId: number | null;
  runAction: (id: number, action: () => Promise<unknown>) => Promise<void>;
}) {
  const me = c.participants.find((p) => p.user_id === userId);
  const others = c.participants.filter((p) => p.user_id !== userId);
  const acceptedParticipants = c.participants.filter((p) => p.status === 'accepted');
  const pot = c.wager_amount * acceptedParticipants.length;

  const disputedReports = acceptedParticipants
    .map((p) => p.reported_winner_id)
    .filter((id): id is number => id !== null);
  const disputed = disputedReports.length >= 2 && new Set(disputedReports).size > 1;

  const winner = c.participants.find((p) => p.user_id === c.winner_id);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="font-medium text-zinc-100">
          Toi vs {others.map((p) => p.username).join(', ')}
        </p>
        <span className="text-xs px-2 py-1 rounded-full bg-zinc-800 text-zinc-400 flex-shrink-0">
          {STATUS_LABELS[c.status]}
        </span>
      </div>

      {others.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {others.map((p) => (
            <span
              key={p.id}
              className={`text-xs px-2 py-0.5 rounded-full ${
                p.status === 'accepted'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : p.status === 'declined'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {p.username} · {PARTICIPANT_STATUS_LABELS[p.status]}
            </span>
          ))}
        </div>
      )}

      <div className="mb-3">
        <p className="text-sm text-zinc-400">
          Mise : {c.wager_amount} SP par joueur
          {acceptedParticipants.length >= 2 && ` · pot : ${pot} SP`}
        </p>
        {c.description && <p className="text-sm text-zinc-500 italic">{c.description}</p>}
      </div>

      {c.status === 'pending' && me?.status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => runAction(c.id, () => challengesApi.acceptChallenge(c.id))}
            disabled={actingId === c.id}
            className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
          >
            Accepter
          </button>
          <button
            onClick={() => runAction(c.id, () => challengesApi.declineChallenge(c.id))}
            disabled={actingId === c.id}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-md transition disabled:opacity-50"
          >
            Décliner
          </button>
        </div>
      )}

      {c.status === 'pending' && me?.status !== 'pending' && (
        <p className="text-sm text-zinc-500">
          En attente de la réponse de{' '}
          {others
            .filter((p) => p.status === 'pending')
            .map((p) => p.username)
            .join(', ')}
          …
        </p>
      )}

      {c.status === 'accepted' && (
        <div>
          {disputed && (
            <p className="text-sm text-red-400 mb-2">
              Vos déclarations ne correspondent pas — le MSP va devoir arbitrer.
            </p>
          )}
          {me?.status === 'accepted' ? (
            me.reported_winner_id !== null ? (
              <p className="text-sm text-zinc-500">
                Tu as déclaré{' '}
                {c.participants.find((p) => p.user_id === me.reported_winner_id)?.username ??
                  '???'}{' '}
                gagnant. En attente de confirmation.
              </p>
            ) : (
              <div>
                <p className="text-sm text-zinc-400 mb-2">Qui a gagné ?</p>
                <div className="flex flex-wrap gap-2">
                  {acceptedParticipants.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => runAction(c.id, () => challengesApi.reportResult(c.id, p.user_id))}
                      disabled={actingId === c.id}
                      className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                    >
                      {p.user_id === userId ? 'Toi' : p.username}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            <p className="text-sm text-zinc-500">Tu ne participes plus à ce défi.</p>
          )}
        </div>
      )}

      {c.status === 'resolved' && (
        <p className="text-sm">
          <span className="text-zinc-400">Gagnant : </span>
          <span className="text-emerald-400 font-medium">
            {winner?.user_id === userId ? 'Toi' : (winner?.username ?? '???')}
          </span>
          <span className="text-zinc-500"> ({pot} SP)</span>
        </p>
      )}
    </div>
  );
}
