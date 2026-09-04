import type { Request, Response } from 'express';
import * as minigameService from '../services/minigame.service.js';
import * as seasonService from '../services/season.service.js';
import * as userService from '../services/user.service.js';
import * as notificationService from '../services/notification.service.js';
import * as discordService from '../services/discord.service.js';
import {
  MINIGAME_GAME_TYPES,
  type AuthenticatedUser,
  type MinigameAnswerView,
  type MinigameParticipantEntry,
  type MinigameQuestionRow,
  type MinigameQuestionView,
  type MinigameStatus,
} from '../types.js';

const VALID_STATUSES: MinigameStatus[] = ['open', 'closed'];

async function buildQuestionView(
  question: MinigameQuestionRow,
  participants: MinigameParticipantEntry[],
  viewer: AuthenticatedUser
): Promise<MinigameQuestionView> {
  const answers = await minigameService.getAnswers(question.id);
  const usernameById = new Map(participants.map((p) => [p.user_id, p.username]));
  const activatedAtMs = new Date(question.activated_at ?? question.created_at).getTime();

  const answerViews: MinigameAnswerView[] = answers.map((a) => {
    const submittedAtMs = new Date(a.submitted_at).getTime();
    const secondsToAnswer = Math.max(0, Math.round((submittedAtMs - activatedAtMs) / 1000));
    const view: MinigameAnswerView = {
      user_id: a.user_id,
      username: usernameById.get(a.user_id) ?? '',
      submitted_at: a.submitted_at,
      seconds_to_answer: secondsToAnswer,
    };
    if (viewer.role === 'admin' || a.user_id === viewer.id) {
      view.answer_text = a.answer_text;
    }
    return view;
  });

  return { ...question, answers: answerViews };
}

async function buildSessionDetail(sessionId: number, viewer: AuthenticatedUser) {
  const session = await minigameService.getSessionById(sessionId);
  if (!session) return null;

  const participants = await minigameService.getSessionParticipants(sessionId);
  const latestQuestion = await minigameService.getLatestQuestion(sessionId);

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
}

export async function createSession(
  req: Request<{}, {}, CreateSessionBody>,
  res: Response
): Promise<void> {
  const gameType = req.body?.gameType;
  const title = req.body?.title?.trim();
  const description = req.body?.description?.trim();
  const entryFeeRaw = req.body?.entryFee;

  if (!gameType || !(MINIGAME_GAME_TYPES as readonly string[]).includes(gameType)) {
    res.status(400).json({ error: 'Type de mini-jeu invalide' });
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

  const activeSeason = await seasonService.getActiveSeason();

  const session = await minigameService.createSession({
    seasonId: activeSeason?.id ?? null,
    gameType,
    title,
    description: description || null,
    entryFee,
    createdBy: req.user!.id,
  });

  const recipientIds = await userService.listAllIds(req.user!.id);
  await notificationService.createNotificationsForUsers(
    recipientIds,
    'minigame_open',
    `Nouveau mini-jeu : ${title}`,
    `/mini-jeux/${session.id}`
  );
  await discordService.sendMinigameLaunchedAlert({
    id: session.id,
    title,
    gameType,
    entryFee,
  });

  res.status(201).json(session);
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const statusParam = req.query.status as string | undefined;
  if (statusParam && !VALID_STATUSES.includes(statusParam as MinigameStatus)) {
    res.status(400).json({ error: 'Statut invalide' });
    return;
  }
  const sessions = await minigameService.listSessions(statusParam as MinigameStatus | undefined);
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

  const session = await minigameService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }

  const participants = await minigameService.getSessionParticipants(sessionId);
  const questions = await minigameService.listQuestions(sessionId);
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

  const session = await minigameService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }

  try {
    await minigameService.joinSession(sessionId, req.user!.id);
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

  const session = await minigameService.getSessionById(sessionId);
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
    await minigameService.addParticipant(sessionId, userId as number);
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

  const participant = await minigameService.getParticipantById(participantId);
  if (!participant || participant.session_id !== sessionId) {
    res.status(404).json({ error: 'Participant introuvable' });
    return;
  }
  if (participant.awarded_at) {
    res.status(400).json({ error: 'Impossible de retirer un participant déjà récompensé' });
    return;
  }

  await minigameService.removeParticipant(participantId);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.json(detail);
}

interface AskQuestionBody {
  prompt?: string;
}

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

  const session = await minigameService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est clôturée' });
    return;
  }

  await minigameService.askQuestion(sessionId, prompt);
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

  const question = await minigameService.getQuestionById(questionId);
  if (!question || question.session_id !== sessionId) {
    res.status(404).json({ error: 'Question introuvable' });
    return;
  }
  if (question.status !== 'active') {
    res.status(400).json({ error: 'Cette question est déjà clôturée' });
    return;
  }

  await minigameService.closeQuestion(questionId);
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

  const question = await minigameService.getQuestionById(questionId);
  if (!question || question.session_id !== sessionId) {
    res.status(404).json({ error: 'Question introuvable' });
    return;
  }
  if (question.status !== 'active') {
    res.status(400).json({ error: 'Cette question est clôturée' });
    return;
  }

  const participant = await minigameService.getParticipantByUser(sessionId, req.user!.id);
  if (!participant) {
    res.status(403).json({ error: 'Tu dois rejoindre la session pour répondre' });
    return;
  }

  try {
    await minigameService.submitAnswer(questionId, req.user!.id, answerText);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const detail = await buildSessionDetail(sessionId, req.user!);
  res.status(201).json(detail);
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
    awarded = await minigameService.awardParticipants(sessionId, awards, req.user!.id);
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
        message: `Tu as gagné +${a.amount} SP au mini-jeu ${detail?.title ?? ''}`.trim(),
        link: `/mini-jeux/${sessionId}`,
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

  const session = await minigameService.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session introuvable' });
    return;
  }
  if (session.status !== 'open') {
    res.status(400).json({ error: 'Cette session est déjà clôturée' });
    return;
  }

  await minigameService.closeSession(sessionId);
  const detail = await buildSessionDetail(sessionId, req.user!);
  res.json(detail);
}
