import { useState, type FormEvent } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import * as speedrunApi from '../api/speedrun.js';
import RankBadge from './RankBadge.jsx';
import Avatar from './Avatar.jsx';
import UserNameTag from './UserNameTag.jsx';
import type { MinigameSessionDetail } from '../types.js';

interface Props {
  sessionId: number;
  session: MinigameSessionDetail;
  isAdmin: boolean;
  userId: number | undefined;
  onSessionChange: (session: MinigameSessionDetail) => void;
  onError: (message: string | null) => void;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export default function SpeedrunSessionDetail({
  sessionId,
  session,
  isAdmin,
  userId,
  onSessionChange,
  onError,
}: Props) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [millis, setMillis] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [reward1st, setReward1st] = useState(String(session.reward_1st ?? 0));
  const [reward2nd, setReward2nd] = useState(String(session.reward_2nd ?? 0));
  const [reward3rd, setReward3rd] = useState(String(session.reward_3rd ?? 0));

  const leaderboard = session.speedrunLeaderboard ?? [];
  const attempts = session.speedrunAttempts ?? [];
  const deadlinePassed = Boolean(session.ends_at && new Date(session.ends_at) <= new Date());
  const canPlay = session.status === 'open' && !deadlinePassed;

  const minutesValue = Number(minutes || 0);
  const secondsValue = Number(seconds || 0);
  const millisValue = Number(millis || 0);
  const totalMs = minutesValue * 60000 + secondsValue * 1000 + millisValue;
  const timeInvalid =
    !Number.isInteger(minutesValue) ||
    minutesValue < 0 ||
    !Number.isInteger(secondsValue) ||
    secondsValue < 0 ||
    secondsValue > 59 ||
    !Number.isInteger(millisValue) ||
    millisValue < 0 ||
    millisValue > 999 ||
    totalMs <= 0;
  let videoUrlValid = false;
  try {
    videoUrlValid = /^https?:$/.test(new URL(videoUrl.trim()).protocol);
  } catch {
    videoUrlValid = false;
  }

  async function handleSubmitAttempt(e: FormEvent) {
    e.preventDefault();
    onError(null);
    if (timeInvalid) {
      onError('Le temps doit être un chronomètre valide (minutes / secondes 0-59 / ms 0-999)');
      return;
    }
    if (!videoUrlValid) {
      onError('Le lien vidéo doit être une URL http(s) valide');
      return;
    }
    setSubmitting(true);
    try {
      const data = await speedrunApi.submitAttempt(sessionId, totalMs, videoUrl.trim());
      onSessionChange(data);
      setMinutes('');
      setSeconds('');
      setMillis('');
      setVideoUrl('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveRewards() {
    const r1 = Number(reward1st);
    const r2 = Number(reward2nd);
    const r3 = Number(reward3rd);
    if (
      !Number.isInteger(r1) ||
      r1 < 0 ||
      !Number.isInteger(r2) ||
      r2 < 0 ||
      !Number.isInteger(r3) ||
      r3 < 0
    ) {
      onError('Les 3 gains doivent être des entiers positifs ou nuls');
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const data = await speedrunApi.updateRewards(sessionId, {
        reward1st: r1,
        reward2nd: r2,
        reward3rd: r3,
      });
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleExcludeAttempt(attemptId: number) {
    const ok = await confirm({
      title: 'Exclure cette tentative',
      message: 'Ce temps ne comptera plus dans le classement ni la distribution des gains.',
      confirmLabel: 'Exclure',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      const data = await speedrunApi.excludeAttempt(sessionId, attemptId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSession() {
    const ok = await confirm({
      title: 'Annuler le mini-jeu',
      message:
        'La session sera clôturée immédiatement sans distribuer aucun gain, même si des joueurs ont déjà soumis un run. Cette action est définitive.',
      confirmLabel: 'Annuler le mini-jeu',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      const data = await speedrunApi.cancelSession(sessionId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseAndDistribute() {
    const ok = await confirm({
      title: 'Clôturer et distribuer',
      message: `Les 3 meilleurs temps recevront respectivement ${session.reward_1st ?? 0}, ${
        session.reward_2nd ?? 0
      } et ${session.reward_3rd ?? 0} SP. Cette action est définitive.`,
      confirmLabel: 'Clôturer et distribuer',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      const data = await speedrunApi.closeAndDistribute(sessionId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(session.game_image_url || session.game_external_url) && (
        <div className="flex items-center gap-3 mb-4">
          {session.game_image_url && (
            <img
              src={session.game_image_url}
              alt=""
              className="h-14 w-14 rounded-lg object-cover flex-shrink-0"
            />
          )}
          {session.game_external_url && (
            <a
              href={session.game_external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-emerald-400 hover:underline"
            >
              Voir sur speedrun.com ↗
            </a>
          )}
        </div>
      )}
      {session.ends_at && (
        <p className="text-sm text-zinc-400 mb-4">
          Date limite :{' '}
          <span className="text-zinc-200 font-medium">
            {new Date(session.ends_at).toLocaleString('fr-FR')}
          </span>
        </p>
      )}

      {(session.reward_1st || session.reward_2nd || session.reward_3rd) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-6">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase mb-3">Gains à la clé</h2>
          <div className="flex flex-wrap gap-4">
            {[
              { rank: 1, amount: session.reward_1st },
              { rank: 2, amount: session.reward_2nd },
              { rank: 3, amount: session.reward_3rd },
            ].map(({ rank, amount }) => (
              <div key={rank} className="flex items-center gap-2">
                <RankBadge rank={rank} size="sm" />
                <span className="font-bold text-emerald-400">{amount ?? 0} SP</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {canPlay ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Soumettre un run</h2>
          <form onSubmit={handleSubmitAttempt} className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Temps (min / sec / ms)</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="min"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  placeholder="sec"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="number"
                  min={0}
                  max={999}
                  step={1}
                  placeholder="ms"
                  value={millis}
                  onChange={(e) => setMillis(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Lien vidéo (preuve)</label>
              <input
                type="url"
                required
                placeholder="https://…"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              Soumettre
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6 text-center">
          <p className="text-zinc-400">
            {session.status === 'cancelled'
              ? 'Session annulée par le MSP — aucun gain distribué.'
              : session.status !== 'open'
                ? 'Session clôturée.'
                : 'Le temps est écoulé — en attente de la distribution des gains.'}
          </p>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-6">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="font-semibold text-zinc-200">Classement</h2>
        </div>
        {leaderboard.length === 0 ? (
          <p className="p-6 text-center text-zinc-500">Aucun run pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Rang</th>
                  <th className="px-4 py-3 text-left">Joueur</th>
                  <th className="px-4 py-3 text-right">Meilleur temps</th>
                  <th className="px-4 py-3 text-right">Preuve</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, i) => (
                  <tr
                    key={entry.user_id}
                    className={`border-t border-zinc-800 ${entry.user_id === userId ? 'bg-emerald-500/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <RankBadge rank={i + 1} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar
                          username={entry.username}
                          avatarUrl={entry.avatar_url}
                          size={28}
                          frameUrl={
                            entry.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')
                              ?.image_url ?? null
                          }
                        />
                        <UserNameTag
                          username={entry.username}
                          equipped={entry.equipped_cosmetics}
                          className="text-zinc-100"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-400 whitespace-nowrap font-mono">
                      {formatTime(entry.best_time_ms)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <a
                        href={entry.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-400 hover:underline"
                      >
                        Vidéo
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Gains (1er / 2e / 3e)</h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <input
              type="number"
              min={0}
              step={1}
              value={reward1st}
              onChange={(e) => setReward1st(e.target.value)}
              disabled={session.status !== 'open'}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            />
            <input
              type="number"
              min={0}
              step={1}
              value={reward2nd}
              onChange={(e) => setReward2nd(e.target.value)}
              disabled={session.status !== 'open'}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            />
            <input
              type="number"
              min={0}
              step={1}
              value={reward3rd}
              onChange={(e) => setReward3rd(e.target.value)}
              disabled={session.status !== 'open'}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            />
          </div>
          {session.status === 'open' && (
            <button
              onClick={handleSaveRewards}
              disabled={busy}
              className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
            >
              Enregistrer les gains
            </button>
          )}

          {attempts.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">
                Historique des tentatives
              </h3>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Joueur</th>
                      <th className="px-3 py-2 text-right">Temps</th>
                      <th className="px-3 py-2 text-left">Vidéo</th>
                      <th className="px-3 py-2 text-left">Quand</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr key={a.id} className="border-t border-zinc-800">
                        <td className="px-3 py-2 text-zinc-200">
                          <UserNameTag username={a.username} />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-zinc-100 font-mono">
                          {formatTime(a.time_ms)}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={a.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:underline"
                          >
                            Vidéo
                          </a>
                        </td>
                        <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                          {new Date(a.submitted_at).toLocaleString('fr-FR')}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {a.excluded_at ? (
                            <span className="text-xs text-zinc-500">Exclue</span>
                          ) : (
                            <button
                              onClick={() => handleExcludeAttempt(a.id)}
                              disabled={busy}
                              className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                            >
                              Exclure
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {session.status === 'open' && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={handleCloseAndDistribute}
                disabled={busy || !deadlinePassed}
                title={!deadlinePassed ? 'Disponible une fois la date limite atteinte' : undefined}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Clôturer et distribuer
              </button>
              <button
                onClick={handleCancelSession}
                disabled={busy}
                title="Annuler le mini-jeu sans distribuer de gain, à tout moment pendant qu'il est ouvert"
                className="bg-red-950/40 hover:bg-red-950/60 text-red-400 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50 border border-red-900/50"
              >
                Annuler le mini-jeu
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
