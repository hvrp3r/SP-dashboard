import { useEffect, useState } from 'react';
import * as challengesApi from '../../api/challenges.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import type { Challenge, ChallengeParticipant, ChallengeStatus } from '../../types.js';

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

const POLL_INTERVAL_MS = 5000;

export default function AdminChallenges() {
  const confirm = useConfirm();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [statusFilter, setStatusFilter] = useState<ChallengeStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [arbitratingId, setArbitratingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await challengesApi.listAllChallenges(statusFilter || undefined);
      setChallenges(data);
      setError(null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter]);

  useEffect(() => {
    const interval = setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [statusFilter]);

  async function handleArbitrate(id: number, winnerId: number) {
    setError(null);
    setArbitratingId(id);
    try {
      await challengesApi.arbitrateChallenge(id, winnerId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setArbitratingId(null);
    }
  }

  async function handleCancel(c: Challenge) {
    const acceptedCount = c.participants.filter((p) => p.status === 'accepted').length;
    const message =
      c.status === 'resolved'
        ? `Les transactions SP liées (gain de ${c.wager_amount * acceptedCount} et pertes de ${c.wager_amount} chacune) seront révoquées et les soldes de tous les participants ajustés en conséquence.`
        : 'Ce défi sera annulé.';
    const ok = await confirm({
      title: 'Annuler le défi',
      message,
      confirmLabel: 'Annuler le défi',
      danger: true,
    });
    if (!ok) return;

    setError(null);
    setCancellingId(c.id);
    try {
      await challengesApi.cancelChallenge(c.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Arbitrage des défis</h1>

        <label className="block mb-4">
          <span className="text-sm text-zinc-400">Statut</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ChallengeStatus | '')}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Tous les statuts</option>
            {(Object.keys(STATUS_LABELS) as ChallengeStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="space-y-3">
          {loading ? (
            <p className="text-zinc-500">Chargement…</p>
          ) : challenges.length === 0 ? (
            <p className="text-zinc-500">Aucun défi.</p>
          ) : (
            challenges.map((c) => {
              const acceptedParticipants = c.participants.filter((p) => p.status === 'accepted');
              const pot = c.wager_amount * acceptedParticipants.length;
              const reports = acceptedParticipants
                .map((p) => p.reported_winner_id)
                .filter((id): id is number => id !== null);
              const disputed = reports.length >= 2 && new Set(reports).size > 1;
              const winner = c.participants.find((p) => p.user_id === c.winner_id);

              const usernameOf = (id: number | null) =>
                c.participants.find((p) => p.user_id === id)?.username ?? '???';

              return (
                <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <p className="font-medium text-zinc-100">
                      {c.participants.map((p) => p.username).join(' vs ')}
                    </p>
                    <span className="text-xs px-2 py-1 rounded-full bg-zinc-800 text-zinc-400 flex-shrink-0">
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>

                  {c.participants.length > 2 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {c.participants.map((p) => (
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

                  <div className="mb-2">
                    <p className="text-sm text-zinc-400">
                      Mise : {c.wager_amount} SP par joueur
                      {acceptedParticipants.length >= 2 && ` · pot : ${pot} SP`}
                    </p>
                    {c.description && (
                      <p className="text-sm text-zinc-500 italic">{c.description}</p>
                    )}
                  </div>

                  {disputed && (
                    <p className="text-sm text-red-400 mb-2">
                      Désaccord :{' '}
                      {acceptedParticipants
                        .filter((p) => p.reported_winner_id !== null)
                        .map((p) => `${p.username} déclare ${usernameOf(p.reported_winner_id)}`)
                        .join(', ')}
                      .
                    </p>
                  )}

                  {c.status === 'resolved' && (
                    <p className="text-sm text-emerald-400">
                      Gagnant : {winner?.username ?? '???'} ({pot} SP)
                    </p>
                  )}

                  {c.status === 'accepted' && (
                    <div className="flex flex-wrap gap-2">
                      {acceptedParticipants.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleArbitrate(c.id, p.user_id)}
                          disabled={arbitratingId === c.id}
                          className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                        >
                          Forcer {p.username}
                        </button>
                      ))}
                    </div>
                  )}

                  {(c.status === 'pending' ||
                    c.status === 'accepted' ||
                    c.status === 'resolved') && (
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      <button
                        onClick={() => handleCancel(c)}
                        disabled={cancellingId === c.id}
                        className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                      >
                        {cancellingId === c.id ? 'Annulation…' : 'Annuler le défi'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
