import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useAnnounceChatRoom } from '../hooks/useChatGameRoom.jsx';
import * as minigamesApi from '../api/minigames.js';
import { gameTypeLabel } from '../lib/minigameLabels.js';
import QuizSessionDetail from '../components/QuizSessionDetail.jsx';
import FlappyBirdSessionDetail from '../components/FlappyBirdSessionDetail.jsx';
import type { MinigameQuestionView, MinigameSessionDetail } from '../types.js';

const POLL_INTERVAL_MS = 2000;

export default function MinigameDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [session, setSession] = useState<MinigameSessionDetail | null>(null);
  const [questions, setQuestions] = useState<MinigameQuestionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useAnnounceChatRoom(
    session
      ? { room: 'minigame', roomKey: String(sessionId), label: session.title || 'Mini-jeu', icon: '🧠' }
      : null
  );

  // Le polling toutes les 2s (plus les rafraîchissements déclenchés par les
  // actions du MSP) peut faire partir plusieurs requêtes `load()` avant que
  // les précédentes n'aient répondu. Sans garde de séquence, une réponse plus
  // ancienne arrivant après une plus récente (réseau plus lent, requête
  // concurrente) écrasait l'état frais avec des données périmées — un
  // `intense_at`/`status` tout juste mis à jour repassait alors en arrière,
  // ce qui relançait la boucle de tension sur `part1` juste après qu'elle ait
  // basculé sur `part2` ou se soit arrêtée à la révélation.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    try {
      const data = await minigamesApi.getSession(sessionId);
      if (seq !== loadSeqRef.current) return;
      setSession(data);
      setError(null);
      // listQuestions est un endpoint quiz-only ; l'appeler pour une session
      // flappy_bird n'apporterait qu'un aller-retour inutile à chaque poll.
      if (data.game_type !== 'flappy_bird') {
        const history = await minigamesApi.listQuestions(sessionId);
        if (seq !== loadSeqRef.current) return;
        setQuestions(history);
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
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

  // Les actions du MSP (poser une question, intensifier, clôturer…) reçoivent
  // directement la session à jour en réponse de leur propre requête — mais un
  // poll lancé juste avant peut encore être en vol et répondre juste après,
  // avec des données plus anciennes. Invalider la séquence ici fait échouer
  // la garde de `load()` sur ce poll-là quand sa réponse arrive, au lieu de
  // laisser cette donnée périmée écraser l'état qu'on vient de recevoir.
  const handleSessionChange = useCallback((data: MinigameSessionDetail) => {
    loadSeqRef.current++;
    setSession(data);
  }, []);

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
                isAdmin={isAdmin}
                userId={user?.id}
                onSessionChange={handleSessionChange}
                onError={setError}
              />
            ) : (
              <QuizSessionDetail
                sessionId={sessionId}
                session={session}
                questions={questions}
                isAdmin={isAdmin}
                userId={user?.id}
                onSessionChange={handleSessionChange}
                onError={setError}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
