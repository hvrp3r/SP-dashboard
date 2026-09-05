import type { Request, Response } from 'express';
import * as minigameService from '../services/minigame.service.js';
import * as flappybirdService from '../services/flappybird.service.js';
import * as notificationService from '../services/notification.service.js';
import { signFlappyBirdAttemptToken, verifyFlappyBirdAttemptToken } from '../utils/jwt.js';
import type { MinigameSessionRow } from '../types.js';

const RANK_LABELS = ['1er', '2e', '3e'];

/** Précondition commune à `startAttempt` et `submitScore` : session jouable maintenant. */
function getPlayableSessionError(session: MinigameSessionRow | null): string | null {
  if (!session) return 'Session introuvable';
  if (session.game_type !== 'flappy_bird') return 'Cette session n’est pas une session Flappy Bird';
  if (session.status !== 'open') return 'Cette session est clôturée';
  if (session.ends_at && new Date(session.ends_at) <= new Date()) {
    return 'Le temps est écoulé, tu ne peux plus jouer';
  }
  return null;
}

export async function startAttempt(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  const error = getPlayableSessionError(session);
  if (error) {
    res.status(session ? 400 : 404).json({ error });
    return;
  }

  const token = signFlappyBirdAttemptToken(sessionId, req.user!.id, 0);
  res.status(201).json({ token });
}

interface AttemptTokenBody {
  token?: string;
}

/**
 * Appelé par le client à chaque point marqué EN JEU (un tuyau passé) — jamais à la
 * fin. Le score n'est donc jamais un nombre déclaré par le client : il n'existe
 * QUE comme le nombre d'appels à cette route acceptés, un par un, chacun devant
 * respecter le délai minimum réel depuis le précédent (voir minDelayForNextPoint).
 * Forger un score élevé exige donc d'envoyer autant de requêtes authentifiées,
 * correctement espacées dans le temps réel, qu'il y a de points — pas juste un
 * curl avec un gros nombre après une pause.
 */
export async function reportPoint(
  req: Request<{ id: string }, {}, AttemptTokenBody>,
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

  const attempt = verifyFlappyBirdAttemptToken(req.body?.token, sessionId, req.user!.id);
  if (!attempt) {
    res.status(400).json({ error: 'Partie non reconnue — relance le jeu avant de rejouer' });
    return;
  }
  const elapsedMs = Date.now() - attempt.iat * 1000;
  if (elapsedMs < flappybirdService.minDelayForNextPoint(attempt.score)) {
    res.status(400).json({ error: 'Point trop rapide pour être plausible' });
    return;
  }

  const token = signFlappyBirdAttemptToken(sessionId, req.user!.id, attempt.score + 1);
  res.status(201).json({ token });
}

export async function submitScore(
  req: Request<{ id: string }, {}, AttemptTokenBody>,
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

  // Le score soumis est TOUJOURS `attempt.score` du token — jamais un champ fourni
  // par le client. Le token n'avance que via reportPoint, un point authentifié à
  // la fois (voir plus haut) : il n'y a donc pas de "score" à falsifier ici.
  const attempt = verifyFlappyBirdAttemptToken(req.body?.token, sessionId, req.user!.id);
  if (!attempt) {
    res.status(400).json({ error: 'Partie non reconnue — relance le jeu avant de rejouer' });
    return;
  }

  await flappybirdService.submitScore(sessionId, req.user!.id, attempt.score);
  const detail = await buildFlappyBirdDetail(sessionId, req.user!.id, req.user!.role === 'admin');
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
  if (!session || session.game_type !== 'flappy_bird') {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }

  const updated = await flappybirdService.updateRewards(sessionId, {
    reward1st: reward1st as number,
    reward2nd: reward2nd as number,
    reward3rd: reward3rd as number,
  });
  if (!updated) {
    res.status(400).json({ error: 'Impossible de mettre à jour les gains' });
    return;
  }

  const detail = await buildFlappyBirdDetail(sessionId, req.user!.id, true);
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

  const attempt = await flappybirdService.getAttemptById(attemptId);
  if (!attempt || attempt.session_id !== sessionId) {
    res.status(404).json({ error: 'Tentative introuvable' });
    return;
  }

  await flappybirdService.excludeAttempt(attemptId, req.user!.id);
  const detail = await buildFlappyBirdDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

export async function closeAndDistribute(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  if (!session || session.game_type !== 'flappy_bird') {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }

  const result = await flappybirdService.closeAndDistribute(sessionId);
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
        message: `Tu as fini ${RANK_LABELS[a.rank - 1] ?? `${a.rank}e`} au Flappy Bird ${
          result.session.title ?? ''
        } — +${a.amount} SP`.trim(),
        link: `/mini-jeux/${sessionId}`,
      })
    )
  );

  const detail = await buildFlappyBirdDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

export async function cancelSession(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await minigameService.getSessionById(sessionId);
  if (!session || session.game_type !== 'flappy_bird') {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session ne peut plus être annulée dans son état actuel' });
    return;
  }

  const cancelled = await flappybirdService.cancelSession(sessionId, req.user!.id);
  if (!cancelled) {
    res.status(400).json({ error: 'Cette session ne peut plus être annulée dans son état actuel' });
    return;
  }

  const userIds = await flappybirdService.listAttemptUserIds(sessionId);
  await Promise.all(
    userIds.map((userId) =>
      notificationService.createNotification({
        userId,
        type: 'minigame_cancelled',
        message: `Le mini-jeu ${cancelled.title ?? 'Flappy Bird'} a été annulé par le MSP — aucun gain ne sera distribué.`,
        link: `/mini-jeux/${sessionId}`,
      })
    )
  );

  const detail = await buildFlappyBirdDetail(sessionId, req.user!.id, true);
  res.json(detail);
}

/** Construit la vue détail Flappy Bird — appelée depuis ce contrôleur et depuis minigames.controller.ts. */
export async function buildFlappyBirdDetail(sessionId: number, viewerId: number, isAdmin: boolean) {
  const session = await minigameService.getSessionById(sessionId);
  if (!session) return null;

  const leaderboard = await flappybirdService.getLeaderboard(sessionId);
  const myBest = leaderboard.find((e) => e.user_id === viewerId) ?? null;
  const attempts = isAdmin ? await flappybirdService.listAttempts(sessionId) : undefined;

  return { ...session, leaderboard, myBest, attempts };
}
