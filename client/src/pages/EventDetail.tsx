import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useAnnounceChatRoom } from '../hooks/useChatGameRoom.jsx';
import * as eventsApi from '../api/events.js';
import { gameTypeIcon, gameTypeLabel } from '../lib/eventLabels.js';
import { canManageSession } from '../lib/permissions.js';
import QuizSessionDetail from '../components/QuizSessionDetail.jsx';
import FlappyBirdSessionDetail from '../components/FlappyBirdSessionDetail.jsx';
import SpeedrunSessionDetail from '../components/SpeedrunSessionDetail.jsx';
import TournamentDetail from '../components/TournamentDetail.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import type { EventKickList, EventQuestionView, EventSessionDetail } from '../types.js';

const POLL_INTERVAL_MS = 2000;

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const { user } = useAuth();

  const [session, setSession] = useState<EventSessionDetail | null>(null);
  const [questions, setQuestions] = useState<EventQuestionView[]>([]);
  const [kicks, setKicks] = useState<EventKickList>({ me: false, kicked: [] });
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useAnnounceChatRoom(
    session
      ? {
          room: 'event',
          roomKey: String(sessionId),
          label: session.title || gameTypeLabel(session.game_type),
          icon: gameTypeIcon(session.game_type),
        }
      : null
  );

  const load = useCallback(async () => {
    try {
      const [data, kickList] = await Promise.all([
        eventsApi.getSession(sessionId),
        eventsApi.listKicks(sessionId),
      ]);
      setSession(data);
      setKicks(kickList);
      setError(null);
      // listQuestions est un endpoint quiz-only ; l'appeler pour une session
      // flappy_bird/speedrun n'apporterait qu'un aller-retour inutile à chaque poll.
      if (data.game_type === 'quiz') {
        const history = await eventsApi.listQuestions(sessionId);
        setQuestions(history);
      }
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
    if (!session || session.status !== 'open') return;
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  // Contrôles de gestion : MSP, ou organisateur ayant créé cette session
  const isManager = session ? canManageSession(user, session) : false;
  const isOrganizer = isManager && user?.role !== 'admin';
  const canKick = isManager && session?.status === 'open';

  async function handleKick(userId: number, username: string) {
    const ok = await confirm({
      title: 'Exclure le joueur',
      message: `${username} sera retiré de l’événement (et de son équipe), sa mise lui sera remboursée et ses scores exclus. Il ne pourra plus rejoindre ni jouer tant que tu ne l’auras pas réintégré.`,
      confirmLabel: 'Exclure',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      const data = await eventsApi.kickPlayer(sessionId, userId);
      setSession(data);
      setKicks(await eventsApi.listKicks(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }

  async function handleUnkick(userId: number) {
    setError(null);
    try {
      const data = await eventsApi.unkickPlayer(sessionId, userId);
      setSession(data);
      setKicks(await eventsApi.listKicks(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/evenements" className="text-sm text-emerald-400 font-medium">
          ← Événements
        </Link>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="mt-4 text-zinc-500">Chargement…</p>
        ) : !session ? (
          <p className="mt-4 text-zinc-500">Session introuvable.</p>
        ) : (
          <>
            {kicks.me && (
              <p className="mt-4 text-sm px-3 py-2 rounded-lg bg-red-500/10 text-red-300 border border-red-500/20">
                Tu as été exclu de cet événement : tu ne peux plus le rejoindre ni y jouer.
              </p>
            )}
            {isOrganizer && (
              <p className="mt-4 text-xs px-3 py-2 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20">
                Tu organises cet événement : tu as accès aux contrôles de gestion.
              </p>
            )}
            <div className="flex items-center justify-between mt-4 mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-2xl font-bold text-zinc-50 truncate">{session.title}</h1>
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
                  {gameTypeLabel(session.game_type)}
                </span>
                {session.entry_fee && (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium uppercase tracking-wide">
                    {session.entry_fee} SP
                  </span>
                )}
              </div>
              <span
                className={`flex-shrink-0 text-xs px-2 py-1 rounded-full ${
                  session.status === 'open'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : session.status === 'cancelled'
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {session.status === 'open' ? 'Ouvert' : session.status === 'cancelled' ? 'Annulé' : 'Clôturé'}
              </span>
            </div>
            {session.description && (
              <p className="text-sm text-zinc-400 mb-4">{session.description}</p>
            )}

            {session.game_type === 'flappy_bird' ? (
              <FlappyBirdSessionDetail
                sessionId={sessionId}
                session={session}
                isAdmin={isManager}
                onKick={canKick ? handleKick : undefined}
                userId={user?.id}
                onSessionChange={setSession}
                onError={setError}
              />
            ) : session.game_type === 'speedrun' ? (
              <SpeedrunSessionDetail
                sessionId={sessionId}
                session={session}
                isAdmin={isManager}
                onKick={canKick ? handleKick : undefined}
                userId={user?.id}
                onSessionChange={setSession}
                onError={setError}
              />
            ) : session.game_type === 'tournament' ? (
              <TournamentDetail
                sessionId={sessionId}
                session={session}
                isAdmin={isManager}
                onKick={canKick ? handleKick : undefined}
                canAward={user?.role === 'admin'}
                userId={user?.id}
                onSessionChange={setSession}
                onError={setError}
              />
            ) : (
              <QuizSessionDetail
                sessionId={sessionId}
                session={session}
                questions={questions}
                isAdmin={isManager}
                onKick={canKick ? handleKick : undefined}
                canAward={user?.role === 'admin'}
                userId={user?.id}
                onSessionChange={setSession}
                onError={setError}
              />
            )}

            {isManager && kicks.kicked.length > 0 && (
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <h2 className="text-sm font-semibold text-zinc-300 mb-2">
                  Joueurs exclus <span className="text-zinc-500">({kicks.kicked.length})</span>
                </h2>
                <ul className="space-y-1">
                  {kicks.kicked.map((k) => (
                    <li key={k.user_id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">
                        {k.username}
                        <span className="ml-2 text-xs text-zinc-500">
                          {new Date(k.kicked_at).toLocaleString('fr-FR')}
                        </span>
                      </span>
                      {session.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => handleUnkick(k.user_id)}
                          className="text-xs text-emerald-400 hover:underline"
                        >
                          Réintégrer
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
