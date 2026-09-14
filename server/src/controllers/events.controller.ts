import type { Request, Response } from 'express';
import * as eventService from '../services/event.service.js';
import * as seasonService from '../services/season.service.js';
import * as userService from '../services/user.service.js';
import * as notificationService from '../services/notification.service.js';
import * as discordService from '../services/discord.service.js';
import { buildFlappyBirdDetail } from './flappybird.controller.js';
import { buildSpeedrunDetail } from './speedrun.controller.js';
import { buildTournamentDetail } from './tournaments.controller.js';
import { isValidHttpUrl } from '../utils/url.js';
import {
  EVENT_GAME_TYPES,
  TOURNAMENT_FORMATS,
  type AuthenticatedUser,
  type EventAnswerView,
  type EventParticipantEntry,
  type EventQuestionRow,
  type EventQuestionView,
  type EventStatus,
  type TournamentFormat,
} from '../types.js';

const VALID_STATUSES: EventStatus[] = ['open', 'closed', 'cancelled'];

async function buildQuestionView(
  question: EventQuestionRow,
  participants: EventParticipantEntry[],
  viewer: AuthenticatedUser
): Promise<EventQuestionView> {
  const answers = await eventService.getAnswers(question.id);
  const participantById = new Map(participants.map((p) => [p.user_id, p]));
  const activatedAtMs = new Date(question.activated_at ?? question.created_at).getTime();

  // Dès que tout le monde a répondu (ou que la question est clôturée, par
  // timer ou par le MSP), les réponses des autres joueurs deviennent visibles
  // par tous — avant ça, seuls le MSP et l'auteur voient le texte.
  const allAnswered =
    participants.length > 0 && participants.every((p) => answers.some((a) => a.user_id === p.user_id));
  const revealed = question.status === 'closed' || allAnswered;

  const answerViews: EventAnswerView[] = answers.map((a) => {
    const submittedAtMs = new Date(a.submitted_at).getTime();
    const secondsToAnswer = Math.max(0, Math.round((submittedAtMs - activatedAtMs) / 1000));
    const participant = participantById.get(a.user_id);
    const view: EventAnswerView = {
      user_id: a.user_id,
      username: participant?.username ?? '',
      avatar_url: participant?.avatar_url ?? null,
      equipped_cosmetics: participant?.equipped_cosmetics ?? [],
      submitted_at: a.submitted_at,
      seconds_to_answer: secondsToAnswer,
    };
    if (viewer.role === 'admin' || a.user_id === viewer.id || revealed) {
      view.answer_text = a.answer_text;
      view.marked_correct = a.marked_correct;
    }
    return view;
  });

  return {
    ...question,
    correct_answer: viewer.role === 'admin' || revealed ? question.correct_answer : undefined,
    answers: answerViews,
  };
}

async function buildSessionDetail(sessionId: number, viewer: AuthenticatedUser) {
  const session = await eventService.getSessionById(sessionId);
  if (!session) return null;

  if (session.game_type === 'flappy_bird') {
    return buildFlappyBirdDetail(sessionId, viewer.id, viewer.role === 'admin');
  }
  if (session.game_type === 'speedrun') {
    return buildSpeedrunDetail(sessionId, viewer.id, viewer.role === 'admin');
  }
  if (session.game_type === 'tournament') {
    return buildTournamentDetail(sessionId);
  }

  await eventService.expireQuestionIfNeeded(sessionId);
  const participants = await eventService.getSessionParticipants(sessionId);
  const latestQuestion = await eventService.getLatestQuestion(sessionId);

  const currentQuestion = latestQuestion
    ? await buildQuestionView(latestQuestion, participants, viewer)
    : null;

  return { ...session, participants, currentQuestion };
}

interface CreateSessionBody {
  gameType?: string;
  title?: string;
  description?: string;
  entryFee?: number;
  endsAt?: string;
  reward1st?: number;
  reward2nd?: number;
  reward3rd?: number;
  gameImageUrl?: string;
  gameExternalUrl?: string;
  tournamentFormat?: string;
  tournamentMaxTeams?: number;
  tournamentTeamSize?: number;
}

export async function createSession(
  req: Request<{}, {}, CreateSessionBody>,
  res: Response
): Promise<void> {
  const gameType = req.body?.gameType;
  const title = req.body?.title?.trim();
  const description = req.body?.description?.trim();
  const entryFeeRaw = req.body?.entryFee;

  if (!gameType || !(EVENT_GAME_TYPES as readonly string[]).includes(gameType)) {
    res.status(400).json({ error: 'Type d’événement invalide' });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'Le titre est requis' });
    return;
  }
  if (title.length > 255) {
    res.status(400).json({ error: 'Le titre ne doit pas dépasser 255 caractères' });
    return;
  }

  let entryFee: number | null = null;
  if (entryFeeRaw !== undefined && entryFeeRaw !== null) {
    if (!Number.isInteger(entryFeeRaw) || entryFeeRaw <= 0) {
      res.status(400).json({ error: 'La mise doit être un entier positif' });
      return;
    }
    entryFee = entryFeeRaw;
  }

  let endsAt: string | null = null;
  let reward1st: number | null = null;
  let reward2nd: number | null = null;
  let reward3rd: number | null = null;

  if (gameType === 'flappy_bird' || gameType === 'speedrun') {
    const endsAtRaw = req.body?.endsAt;
    const parsedEndsAt = endsAtRaw ? new Date(endsAtRaw) : null;
    if (!parsedEndsAt || Number.isNaN(parsedEndsAt.getTime()) || parsedEndsAt <= new Date()) {
      res.status(400).json({ error: 'La date limite doit être une date valide dans le futur' });
      return;
    }
    const { reward1st: r1, reward2nd: r2, reward3rd: r3 } = req.body ?? {};
    if (
      !Number.isInteger(r1) ||
      !Number.isInteger(r2) ||
      !Number.isInteger(r3) ||
      (r1 as number) < 0 ||
      (r2 as number) < 0 ||
      (r3 as number) < 0
    ) {
      res.status(400).json({ error: 'Les 3 gains doivent être des entiers positifs ou nuls' });
      return;
    }
    endsAt = parsedEndsAt.toISOString();
    reward1st = r1 as number;
    reward2nd = r2 as number;
    reward3rd = r3 as number;
  }

  // Rattachement optionnel à une fiche jeu speedrun.com (voir speedruncom.service.ts) —
  // jamais requis : le MSP peut toujours saisir titre/description à la main sans
  // passer par la recherche, auquel cas ces deux champs restent null.
  let gameImageUrl: string | null = null;
  let gameExternalUrl: string | null = null;
  if (gameType === 'speedrun') {
    const gameImageUrlRaw = req.body?.gameImageUrl?.trim();
    if (gameImageUrlRaw) {
      if (!isValidHttpUrl(gameImageUrlRaw)) {
        res.status(400).json({ error: "L'image du jeu doit être une URL http(s) valide" });
        return;
      }
      gameImageUrl = gameImageUrlRaw;
    }
    const gameExternalUrlRaw = req.body?.gameExternalUrl?.trim();
    if (gameExternalUrlRaw) {
      if (!isValidHttpUrl(gameExternalUrlRaw)) {
        res.status(400).json({ error: 'Le lien du jeu doit être une URL http(s) valide' });
        return;
      }
      gameExternalUrl = gameExternalUrlRaw;
    }
  }

  // Paramètres requis du tournoi : format, nombre d'équipes et taille d'équipe.
  // La dotation (reward_1st/2nd/3rd = SP par membre) est obligatoire mais peut
  // être à 0 — les récompenses se font alors uniquement via ajustements libres.
  let tournamentFormat: string | null = null;
  let tournamentMaxTeams: number | null = null;
  let tournamentTeamSize: number | null = null;
  let tournamentRewards: { reward1st: number; reward2nd: number; reward3rd: number } | null = null;
  if (gameType === 'tournament') {
    const rawFormat = req.body?.tournamentFormat;
    if (!rawFormat || !(TOURNAMENT_FORMATS as readonly string[]).includes(rawFormat)) {
      res.status(400).json({ error: 'Format de tournoi invalide' });
      return;
    }
    const maxTeams = req.body?.tournamentMaxTeams;
    const teamSize = req.body?.tournamentTeamSize;
    if (!Number.isInteger(maxTeams) || (maxTeams as number) < 2 || (maxTeams as number) > 64) {
      res.status(400).json({ error: 'Le nombre d’équipes doit être un entier entre 2 et 64' });
      return;
    }
    if (!Number.isInteger(teamSize) || (teamSize as number) < 1 || (teamSize as number) > 16) {
      res.status(400).json({ error: 'La taille d’équipe doit être un entier entre 1 et 16' });
      return;
    }
    const t1 = req.body?.reward1st;
    const t2 = req.body?.reward2nd;
    const t3 = req.body?.reward3rd;
    if (
      !Number.isInteger(t1) ||
      !Number.isInteger(t2) ||
      !Number.isInteger(t3) ||
      (t1 as number) < 0 ||
      (t2 as number) < 0 ||
      (t3 as number) < 0
    ) {
      res.status(400).json({
        error: 'La dotation (3 rangs) doit être des entiers positifs ou nuls',
      });
      return;
    }
    tournamentFormat = rawFormat as TournamentFormat;
    tournamentMaxTeams = maxTeams as number;
    tournamentTeamSize = teamSize as number;
    tournamentRewards = {
      reward1st: t1 as number,
      reward2nd: t2 as number,
      reward3rd: t3 as number,
    };
  }

  const activeSeason = await seasonService.getActiveSeason();

  const session = await eventService.createSession({
    seasonId: activeSeason?.id ?? null,
    gameType,
    title,
    description: description || null,
    entryFee,
    createdBy: req.user!.id,
    endsAt,
    reward1st: tournamentRewards?.reward1st ?? reward1st,
    reward2nd: tournamentRewards?.reward2nd ?? reward2nd,
    reward3rd: tournamentRewards?.reward3rd ?? reward3rd,
    gameImageUrl,
    gameExternalUrl,
    tournamentFormat,
    tournamentMaxTeams,
    tournamentTeamSize,
  });

  const recipientIds = await userService.listAllIds(req.user!.id);
  const openMessage =
    gameType === 'tournament' ? `Nouveau tournoi : ${title}` : `Nouvel événement : ${title}`;
  await notificationService.createNotificationsForUsers(
    recipientIds,
    'event_open',
    openMessage,
    `/evenements/${session.id}`
  );
  await discordService.sendEventLaunchedAlert({
    id: session.id,
    title,
    gameType,
    entryFee,
  });

  res.status(201).json(session);
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const statusParam = req.query.status as string | undefined;
  if (statusParam && !VALID_STATUSES.includes(statusParam as EventStatus)) {
    res.status(400).json({ error: 'Statut invalide' });
    return;
  }
  const sessions = await eventService.listSessions(statusParam as EventStatus | undefined);
  res.json(sessions);
}

export async function getSession(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  const detail = await buildSessionDetail(sessionId, req.user!);
  if (!detail) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  res.json(detail);
}

export async function listQuestions(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await eventService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }

  await eventService.expireQuestionIfNeeded(sessionId);
  const participants = await eventService.getSessionParticipants(sessionId);
  const questions = await eventService.listQuestions(sessionId);
  const views = await Promise.all(
    questions.map((q) => buildQuestionView(q, participants, req.user!))
  );

  res.json(views);
}

export async function joinSession(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await eventService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }
  if (session.game_type === 'tournament') {
    const capacity = (session.tournament_max_teams ?? 0) * (session.tournament_team_size ?? 0);
    const count = await eventService.countSessionParticipants(sessionId);
    if (capacity > 0 && count >= capacity) {
      res.status(400).json({ error: 'Ce tournoi est complet' });
      return;
    }
  }

  try {
    await eventService.joinSession(sessionId, req.user!.id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const detail = await buildSessionDetail(sessionId, req.user!);
  res.status(201).json(detail);
}

interface AddParticipantBody {
  userId?: number;
}

export async function addParticipant(
  req: Request<{ id: string }, {}, AddParticipantBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  const { userId } = req.body ?? {};
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'Le joueur est requis' });
    return;
  }

  const session = await eventService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }

  const player = await userService.findById(userId as number);
  if (!player) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }

  try {
    await eventService.addParticipant(sessionId, userId as number);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const detail = await buildSessionDetail(sessionId, req.user!);
  res.status(201).json(detail);
}

export async function removeParticipant(
  req: Request<{ id: string; participantId: string }>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  const participantId = Number(req.params.participantId);
  if (!Number.isInteger(sessionId) || !Number.isInteger(participantId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const participant = await eventService.getParticipantById(participantId);
  if (!participant || participant.session_id !== sessionId) {
    res.status(404).json({ error: 'Participant introuvable' });
    return;
  }
  if (participant.awarded_at) {
    res.status(400).json({ error: 'Impossible de retirer un participant déjà récompensé' });
    return;
  }

  await eventService.removeParticipant(participantId);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.json(detail);
}

interface AskQuestionBody {
  prompt?: string;
  durationSeconds?: number;
  correctAnswer?: string;
}

const MAX_QUESTION_DURATION_SECONDS = 3600;
const MAX_CORRECT_ANSWER_LENGTH = 255;

export async function askQuestion(
  req: Request<{ id: string }, {}, AskQuestionBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  const prompt = req.body?.prompt?.trim();
  if (!prompt) {
    res.status(400).json({ error: 'La question est requise' });
    return;
  }

  const durationSecondsRaw = req.body?.durationSeconds;
  let durationSeconds: number | null = null;
  if (durationSecondsRaw !== undefined && durationSecondsRaw !== null) {
    if (
      !Number.isInteger(durationSecondsRaw) ||
      durationSecondsRaw <= 0 ||
      durationSecondsRaw > MAX_QUESTION_DURATION_SECONDS
    ) {
      res.status(400).json({ error: 'La durée doit être un entier entre 1 et 3600 secondes' });
      return;
    }
    durationSeconds = durationSecondsRaw;
  }

  const correctAnswerRaw = req.body?.correctAnswer?.trim();
  if (correctAnswerRaw && correctAnswerRaw.length > MAX_CORRECT_ANSWER_LENGTH) {
    res.status(400).json({ error: 'La réponse correcte ne doit pas dépasser 255 caractères' });
    return;
  }
  const correctAnswer = correctAnswerRaw || null;

  const session = await eventService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }

  await eventService.askQuestion(sessionId, prompt, durationSeconds, correctAnswer);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.status(201).json(detail);
}

export async function closeQuestion(
  req: Request<{ id: string; questionId: string }>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  const questionId = Number(req.params.questionId);
  if (!Number.isInteger(sessionId) || !Number.isInteger(questionId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const question = await eventService.getQuestionById(questionId);
  if (!question || question.session_id !== sessionId) {
    res.status(404).json({ error: 'Question introuvable' });
    return;
  }
  if (question.status !== 'active') {
    res.status(400).json({ error: 'Cette question est déjà clôturée' });
    return;
  }

  await eventService.closeQuestion(questionId);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.json(detail);
}

interface AnswerBody {
  answerText?: string;
}

export async function submitAnswer(
  req: Request<{ id: string; questionId: string }, {}, AnswerBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  const questionId = Number(req.params.questionId);
  if (!Number.isInteger(sessionId) || !Number.isInteger(questionId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const answerText = req.body?.answerText?.trim();
  if (!answerText) {
    res.status(400).json({ error: 'La réponse est requise' });
    return;
  }

  await eventService.expireQuestionIfNeeded(sessionId);
  const question = await eventService.getQuestionById(questionId);
  if (!question || question.session_id !== sessionId) {
    res.status(404).json({ error: 'Question introuvable' });
    return;
  }
  if (question.status !== 'active') {
    res.status(400).json({ error: 'Cette question est clôturée' });
    return;
  }

  const participant = await eventService.getParticipantByUser(sessionId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: 'Tu dois rejoindre la session pour répondre' });
    return;
  }

  try {
    await eventService.submitAnswer(questionId, req.user!.id, answerText);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const detail = await buildSessionDetail(sessionId, req.user!);
  res.status(201).json(detail);
}

interface GradeAnswerBody {
  correct?: boolean | null;
}

/**
 * Verdict manuel du MSP sur la réponse d'un joueur — prioritaire côté client
 * sur le simple rapprochement texte avec `correct_answer` (voir
 * buildQuestionView pour la visibilité du texte/verdict).
 */
export async function gradeAnswer(
  req: Request<{ id: string; questionId: string; userId: string }, {}, GradeAnswerBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  const questionId = Number(req.params.questionId);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(sessionId) || !Number.isInteger(questionId) || !Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const correct = req.body?.correct;
  if (correct !== null && correct !== undefined && typeof correct !== 'boolean') {
    res.status(400).json({ error: 'correct doit être un booléen ou null' });
    return;
  }

  const question = await eventService.getQuestionById(questionId);
  if (!question || question.session_id !== sessionId) {
    res.status(404).json({ error: 'Question introuvable' });
    return;
  }

  const answer = await eventService.getAnswer(questionId, userId);
  if (!answer) {
    res.status(404).json({ error: 'Réponse introuvable' });
    return;
  }

  await eventService.gradeAnswer(questionId, userId, correct ?? null);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.json(detail);
}

interface AwardBody {
  awards?: Array<{ participantId?: number; amount?: number }>;
}

export async function awardParticipants(
  req: Request<{ id: string }, {}, AwardBody>,
  res: Response
): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const awardsInput = req.body?.awards;
  if (!Array.isArray(awardsInput) || awardsInput.length === 0) {
    res.status(400).json({ error: 'Liste d’attributions requise' });
    return;
  }

  const awards: { participantId: number; amount: number }[] = [];
  for (const entry of awardsInput) {
    if (
      !Number.isInteger(entry.participantId) ||
      !Number.isInteger(entry.amount) ||
      (entry.amount as number) < 0
    ) {
      res.status(400).json({ error: 'Attribution invalide' });
      return;
    }
    awards.push({ participantId: entry.participantId as number, amount: entry.amount as number });
  }

  let awarded;
  try {
    awarded = await eventService.awardParticipants(sessionId, awards, req.user!.id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const detail = await buildSessionDetail(sessionId, req.user!);

  await Promise.all(
    awarded.map((a) =>
      notificationService.createNotification({
        userId: a.userId,
        type: 'sp_gained',
        message: `Tu as gagné +${a.amount} SP à l'événement ${detail?.title ?? ''}`.trim(),
        link: `/evenements/${sessionId}`,
      })
    )
  );

  res.json(detail);
}

export async function closeSession(req: Request<{ id: string }>, res: Response): Promise<void> {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }

  const session = await eventService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est déjà clôturée' });
    return;
  }

  await eventService.closeSession(sessionId);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.json(detail);
}
