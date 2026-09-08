import type { Request, Response } from 'express';
import * as minigameService from '../services/minigame.service.js';
import * as speedrunService from '../services/speedrun.service.js';
import * as speedruncomService from '../services/speedruncom.service.js';
import * as notificationService from '../services/notification.service.js';
import { isValidHttpUrl } from '../utils/url.js';
import type { MinigameSessionRow } from '../types.js';

const RANK_LABELS = ['1er', '2e', '3e'];
const MAX_TIME_MS = 24 * 60 * 60 * 1000; // 24h — large marge, exclut surtout les valeurs aberrantes

/**
 * Proxy la recherche de jeux speedrun.com pour le formulaire de création (MSP
 * uniquement) — jamais appelé côté client directement, pour ne pas exposer cette
 * API tierce sans authentification ni contrôle de fréquence.
 */
export async function searchGames(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.json([]);
    return;
  }

  try {
    const results = await speedruncomService.searchGames(q);
    res.json(results);
  } catch {
    res.status(502).json({ error: 'Impossible de contacter speedrun.com' });
  }
}

/** Précondition commune : session jouable maintenant. */
function getPlayableSessionError(session: MinigameSessionRow | null): string | null {
  if (!session) return 'Session introuvable';
  if (session.game_type !== 'speedrun') return 'Cette session n’est pas une session Speedrun';
  if (session.status !== 'open') return 'Cette session est clôturée';
  if (session.ends_at && new Date(session.ends_at) <= new Date()) {
    return 'Le temps est écoulé, tu ne peux plus soumettre de run';
  }
  return null;
}

interface SubmitAttemptBody {
  timeMs?: number;
  videoUrl?: string;
}

export async function submitAttempt(
  req: Request<{ id: string }, {}, SubmitAttemptBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  const playableError = getPlayableSessionError(session);
  if (playableError) {
    res.status(session ? 400 : 404).json({ error: playableError });
    return;
  }

  const { timeMs, videoUrl } = req.body ?? {};
  if (!Number.isInteger(timeMs) || (timeMs as number) <= 0 || (timeMs as number) > MAX_TIME_MS) {
    res.status(400).json({ error: 'Le temps doit être un nombre de millisecondes positif' });
    return;
  }
  if (typeof videoUrl !== 'string' || !isValidHttpUrl(videoUrl.trim())) {
    res.status(400).json({ error: 'Le lien vidéo doit être une URL http(s) valide' });
    return;
  }

  await speedrunService.submitAttempt(sessionId, req.user!.id, timeMs as number, videoUrl.trim());
  const detail = await buildSpeedrunDetail(sessionId, req.user!.id, req.user!.role === 'admin');
  res.status(201).json(detail);
}

interface UpdateRewardsBody {
  reward1st?: number;
  reward2nd?: number;
  reward3rd?: number;
}

export async function updateRewards(
  req: Request<{ id: string }, {}, UpdateRewardsBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const { reward1st, reward2nd, reward3rd } = req.body ?? {};
  if (
    !Number.isInteger(reward1st) ||
    !Number.isInteger(reward2nd) ||
    !Number.isInteger(reward3rd) ||
    (reward1st as number) < 0 ||
    (reward2nd as number) < 0 ||
    (reward3rd as number) < 0
  ) {
    res.status(400).json({ error: 'Les 3 gains doivent être des entiers positifs ou nuls' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  if (!session || session.game_type !== 'speedrun') {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }

  const updated = await speedrunService.updateRewards(sessionId, {
    reward1st: reward1st as number,
    reward2nd: reward2nd as number,
    reward3rd: reward3rd as number,
  });
  if (!updated) {
    res.status(400).json({ error: 'Impossible de mettre à jour les gains' });
    return;
  }

  const detail = await buildSpeedrunDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

export async function excludeAttempt(
  req: Request<{ id: string; attemptId: string }>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  const attemptId = Number(req.params.attemptId);
  if (!Number.isInteger(sessionId) || !Number.isInteger(attemptId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const attempt = await speedrunService.getAttemptById(attemptId);
  if (!attempt || attempt.session_id !== sessionId) {
    res.status(404).json({ error: 'Tentative introuvable' });
    return;
  }

  await speedrunService.excludeAttempt(attemptId, req.user!.id);
  const detail = await buildSpeedrunDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

export async function closeAndDistribute(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  if (!session || session.game_type !== 'speedrun') {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }

  const result = await speedrunService.closeAndDistribute(sessionId);
  if (!result) {
    if (session.status !== 'open') {
      res.status(400).json({ error: 'Cette session est déjà clôturée' });
      return;
    }
    res.status(400).json({ error: 'La date limite n’est pas encore atteinte' });
    return;
  }

  await Promise.all(
    result.awarded.map((a) =>
      notificationService.createNotification({
        userId: a.userId,
        type: 'sp_gained',
        message: `Tu as fini ${RANK_LABELS[a.rank - 1] ?? `${a.rank}e`} au Speedrun ${
          result.session.title ?? ''
        } — +${a.amount} SP`.trim(),
        link: `/mini-jeux/${sessionId}`,
      })
    )
  );

  const detail = await buildSpeedrunDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

export async function cancelSession(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  if (!session || session.game_type !== 'speedrun') {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session ne peut plus être annulée dans son état actuel' });
    return;
  }

  const cancelled = await speedrunService.cancelSession(sessionId, req.user!.id);
  if (!cancelled) {
    res.status(400).json({ error: 'Cette session ne peut plus être annulée dans son état actuel' });
    return;
  }

  const userIds = await speedrunService.listAttemptUserIds(sessionId);
  await Promise.all(
    userIds.map((userId) =>
      notificationService.createNotification({
        userId,
        type: 'minigame_cancelled',
        message: `Le mini-jeu ${cancelled.title ?? 'Speedrun'} a été annulé par le MSP — aucun gain ne sera distribué.`,
        link: `/mini-jeux/${sessionId}`,
      })
    )
  );

  const detail = await buildSpeedrunDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

/** Construit la vue détail Speedrun — appelée depuis ce contrôleur et depuis minigames.controller.ts. */
export async function buildSpeedrunDetail(sessionId: number, viewerId: number, isAdmin: boolean) {
  const session = await minigameService.getSessionById(sessionId);
  if (!session) return null;

  const speedrunLeaderboard = await speedrunService.getLeaderboard(sessionId);
  const mySpeedrunBest = speedrunLeaderboard.find((e) => e.user_id === viewerId) ?? null;
  const speedrunAttempts = isAdmin ? await speedrunService.listAttempts(sessionId) : undefined;

  return { ...session, speedrunLeaderboard, mySpeedrunBest, speedrunAttempts };
}
