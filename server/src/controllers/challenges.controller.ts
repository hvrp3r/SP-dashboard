import type { Request, Response } from 'express';
import * as challengeService from '../services/challenge.service.js';
import * as configService from '../services/config.service.js';
import * as seasonService from '../services/season.service.js';
import * as userService from '../services/user.service.js';
import * as notificationService from '../services/notification.service.js';
import type { ChallengeEntry, ChallengeStatus } from '../types.js';

const VALID_STATUSES: ChallengeStatus[] = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'resolved',
  'cancelled',
];

async function expireAndNotify(): Promise<void> {
  const expired = await challengeService.expirePendingChallenges();
  await Promise.all(
    expired
      .filter((c) => c.finalStatus === 'declined')
      .map((c) =>
        notificationService.createNotification({
          userId: c.challenger_id,
          type: 'challenge_expired',
          message: 'Ton défi a expiré : pas assez de joueurs ont accepté à temps',
          link: '/defis',
        })
      )
  );
}

async function notifyChallengeCancelled(entry: ChallengeEntry): Promise<void> {
  const wasResolved = entry.resolved_at !== null && entry.winner_id !== null;
  const acceptedParticipants = entry.participants.filter((p) => p.status === 'accepted');

  await Promise.all(
    acceptedParticipants.map((participant) => {
      let adjustment: number | null = null;
      if (wasResolved) {
        adjustment =
          participant.user_id === entry.winner_id
            ? -(entry.wager_amount * acceptedParticipants.length)
            : entry.wager_amount;
      }
      const base = 'Le MSP a annulé le défi';
      const message =
        adjustment !== null && adjustment !== 0
          ? `${base}. Ajustement : ${adjustment >= 0 ? '+' : ''}${adjustment} SP`
          : `${base}.`;
      return notificationService.createNotification({
        userId: participant.user_id,
        type: 'challenge_cancelled',
        message,
        link: '/defis',
      });
    })
  );
}

async function notifyChallengeResolved(entry: ChallengeEntry): Promise<void> {
  const winner = entry.participants.find((p) => p.user_id === entry.winner_id);
  const acceptedCount = entry.participants.filter((p) => p.status === 'accepted').length;
  const message = `Défi terminé : ${winner?.username ?? '???'} a gagné ${entry.wager_amount * acceptedCount} SP`;
  await Promise.all(
    entry.participants
      .filter((p) => p.status === 'accepted')
      .map((p) =>
        notificationService.createNotification({
          userId: p.user_id,
          type: 'challenge_resolved',
          message,
          link: '/defis',
        })
      )
  );
}

interface CreateChallengeBody {
  opponentIds?: number[];
  wagerAmount?: number;
  description?: string;
}

export async function createChallenge(
  req: Request<{}, {}, CreateChallengeBody>,
  res: Response
): Promise<void> {
  const { opponentIds, wagerAmount, description } = req.body ?? {};

  if (!Array.isArray(opponentIds) || opponentIds.length === 0) {
    res.status(400).json({ error: 'Au moins un adversaire est requis' });
    return;
  }
  const uniqueOpponentIds = Array.from(new Set(opponentIds));
  if (!uniqueOpponentIds.every((id) => Number.isInteger(id))) {
    res.status(400).json({ error: 'Adversaire invalide' });
    return;
  }
  if (!Number.isInteger(wagerAmount)) {
    res.status(400).json({ error: 'La mise est requise' });
    return;
  }
  if ((wagerAmount as number) <= 0) {
    res.status(400).json({ error: 'La mise doit être positive' });
    return;
  }
  if (uniqueOpponentIds.includes(req.user!.id)) {
    res.status(400).json({ error: 'Impossible de se défier soi-même' });
    return;
  }
  if (description !== undefined && description.length > 500) {
    res.status(400).json({ error: 'La description ne doit pas dépasser 500 caractères' });
    return;
  }

  const challenger = await userService.findById(req.user!.id);
  if (!challenger) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }

  const opponents = await Promise.all(uniqueOpponentIds.map((id) => userService.findById(id)));
  if (opponents.some((o) => !o)) {
    res.status(404).json({ error: 'Un des joueurs défiés est introuvable' });
    return;
  }

  const maxWager = await configService.getConfigNumber('max_wager_amount', 100);
  if ((wagerAmount as number) > maxWager) {
    res.status(400).json({ error: `La mise ne peut pas dépasser ${maxWager} SP` });
    return;
  }
  if (challenger.sp_balance < (wagerAmount as number)) {
    res.status(400).json({ error: 'Solde SP insuffisant pour cette mise' });
    return;
  }
  const brokeOpponents = opponents.filter((o) => o!.sp_balance < (wagerAmount as number));
  if (brokeOpponents.length > 0) {
    res.status(400).json({
      error: `Solde SP insuffisant pour : ${brokeOpponents.map((o) => o!.username).join(', ')}`,
    });
    return;
  }

  const maxPerDay = await configService.getConfigNumber('max_challenges_per_day', 5);
  const countToday = await challengeService.countChallengesToday(req.user!.id);
  if (countToday >= maxPerDay) {
    res.status(400).json({ error: `Limite de ${maxPerDay} défis par jour atteinte` });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();
  const trimmedDescription = description?.trim() || null;

  const challenge = await challengeService.createChallenge({
    seasonId: activeSeason?.id ?? null,
    challengerId: req.user!.id,
    opponentIds: uniqueOpponentIds,
    wagerAmount: wagerAmount as number,
    description: trimmedDescription,
  });

  await Promise.all(
    uniqueOpponentIds.map((id) =>
      notificationService.createNotification({
        userId: id,
        type: 'challenge_received',
        message: `${challenger.username} t'a défié pour ${wagerAmount} SP`,
        link: '/defis',
      })
    )
  );

  const entry = await challengeService.getChallengeEntryById(challenge.id);
  res.status(201).json(entry);
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  const [maxPerDay, countToday] = await Promise.all([
    configService.getConfigNumber('max_challenges_per_day', 5),
    challengeService.countChallengesToday(req.user!.id),
  ]);
  res.json({ maxPerDay, countToday });
}

export async function listMyChallenges(req: Request, res: Response): Promise<void> {
  await expireAndNotify();
  const challenges = await challengeService.listMyChallenges(req.user!.id);
  res.json(challenges);
}

export async function listAllChallenges(req: Request, res: Response): Promise<void> {
  await expireAndNotify();

  const statusParam = req.query.status as string | undefined;
  if (statusParam && !VALID_STATUSES.includes(statusParam as ChallengeStatus)) {
    res.status(400).json({ error: 'Statut invalide' });
    return;
  }

  const challenges = await challengeService.listAllChallenges({
    status: statusParam as ChallengeStatus | undefined,
  });
  res.json(challenges);
}

function parseChallengeId(req: Request<{ id: string }>, res: Response): number | null {
  const challengeId = Number(req.params.id);
  if (!Number.isInteger(challengeId)) {
    res.status(400).json({ error: 'Identifiant de défi invalide' });
    return null;
  }
  return challengeId;
}

export async function acceptChallenge(req: Request<{ id: string }>, res: Response): Promise<void> {
  await expireAndNotify();
  const challengeId = parseChallengeId(req, res);
  if (challengeId === null) return;

  const challenge = await challengeService.getChallengeById(challengeId);
  if (!challenge) {
    res.status(404).json({ error: 'Défi introuvable' });
    return;
  }
  const me = await userService.findById(req.user!.id);
  if (!me || me.sp_balance < challenge.wager_amount) {
    res.status(400).json({ error: 'Solde SP insuffisant pour accepter ce défi' });
    return;
  }

  try {
    await challengeService.respondToChallenge(challengeId, req.user!.id, 'accepted');
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const entry = await challengeService.getChallengeEntryById(challengeId);
  if (entry) {
    await notificationService.createNotification({
      userId: entry.challenger_id,
      type: 'challenge_accepted',
      message: `${req.user!.username} a accepté ton défi`,
      link: '/defis',
    });
  }
  res.json(entry);
}

export async function declineChallenge(req: Request<{ id: string }>, res: Response): Promise<void> {
  await expireAndNotify();
  const challengeId = parseChallengeId(req, res);
  if (challengeId === null) return;

  try {
    await challengeService.respondToChallenge(challengeId, req.user!.id, 'declined');
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const entry = await challengeService.getChallengeEntryById(challengeId);
  if (entry) {
    await notificationService.createNotification({
      userId: entry.challenger_id,
      type: 'challenge_declined',
      message: `${req.user!.username} a décliné ton défi`,
      link: '/defis',
    });
  }
  res.json(entry);
}

interface ReportBody {
  winnerId?: number;
}

export async function reportResult(
  req: Request<{ id: string }, {}, ReportBody>,
  res: Response
): Promise<void> {
  const challengeId = parseChallengeId(req, res);
  if (challengeId === null) return;

  const challenge = await challengeService.getChallengeById(challengeId);
  if (!challenge) {
    res.status(404).json({ error: 'Défi introuvable' });
    return;
  }
  if (challenge.status !== 'accepted') {
    res.status(400).json({ error: "Ce défi n'est pas en cours" });
    return;
  }

  const { winnerId } = req.body ?? {};
  const userId = req.user!.id;

  const participants = await challengeService.getParticipants(challengeId);
  const me = participants.find((p) => p.user_id === userId && p.status === 'accepted');
  if (!me) {
    res.status(403).json({ error: 'Tu ne participes pas à ce défi' });
    return;
  }
  const winnerIsParticipant = participants.some(
    (p) => p.user_id === winnerId && p.status === 'accepted'
  );
  if (!winnerIsParticipant) {
    res.status(400).json({ error: 'Le gagnant doit être un participant ayant accepté le défi' });
    return;
  }

  await challengeService.submitReport(challengeId, userId, winnerId as number);

  const updatedParticipants = await challengeService.getParticipants(challengeId);
  const accepted = updatedParticipants.filter((p) => p.status === 'accepted');
  const allReported = accepted.every((p) => p.reported_winner_id !== null);
  const uniqueWinners = new Set(accepted.map((p) => p.reported_winner_id));
  const agree = allReported && uniqueWinners.size === 1;

  if (agree) {
    try {
      await challengeService.resolveChallenge(challengeId, [...uniqueWinners][0] as number, false);
    } catch (err) {
      const entry = await challengeService.getChallengeEntryById(challengeId);
      res.json({
        ...entry,
        resolutionError:
          err instanceof Error ? err.message : 'Résolution automatique impossible, contactez le MSP',
      });
      return;
    }
  }

  const entry = await challengeService.getChallengeEntryById(challengeId);
  if (agree && entry) {
    await notifyChallengeResolved(entry);
  }
  res.json(entry);
}

interface ArbitrateBody {
  winnerId?: number;
  note?: string;
}

export async function arbitrateChallenge(
  req: Request<{ id: string }, {}, ArbitrateBody>,
  res: Response
): Promise<void> {
  const challengeId = parseChallengeId(req, res);
  if (challengeId === null) return;

  const { winnerId, note } = req.body ?? {};
  if (!Number.isInteger(winnerId)) {
    res.status(400).json({ error: 'Le gagnant est requis' });
    return;
  }

  try {
    await challengeService.resolveChallenge(challengeId, winnerId as number, true, note ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const entry = await challengeService.getChallengeEntryById(challengeId);
  if (entry) {
    await notifyChallengeResolved(entry);
  }
  res.json(entry);
}

export async function cancelChallenge(req: Request<{ id: string }>, res: Response): Promise<void> {
  const challengeId = parseChallengeId(req, res);
  if (challengeId === null) return;

  try {
    await challengeService.cancelChallenge(challengeId, req.user!.id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const entry = await challengeService.getChallengeEntryById(challengeId);
  if (entry) {
    await notifyChallengeCancelled(entry);
  }
  res.json(entry);
}
