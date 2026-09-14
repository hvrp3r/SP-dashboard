import type { Request, Response } from 'express';
import * as eventService from '../services/event.service.js';
import * as tournamentService from '../services/tournament.service.js';
import * as notificationService from '../services/notification.service.js';

const RANK_LABELS = ['1er', '2e', '3e'];

function logoUrlFromRequest(req: Request): string | null {
  if (!req.file) return null;
  return `/uploads/team-logos/${req.file.filename}`;
}

function parseSessionId(req: Request): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

function handleError(res: Response, err: unknown): void {
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
}

/** Construit la vue détail Tournoi — appelée depuis ce contrôleur et depuis
 * events.controller.ts (routage par game_type). */
export async function buildTournamentDetail(sessionId: number) {
  const session = await eventService.getSessionById(sessionId);
  if (!session || session.game_type !== 'tournament') return null;

  const [participants, teams, matches, announcements, state] = await Promise.all([
    eventService.getSessionParticipants(sessionId),
    tournamentService.getSessionTeamsWithMembers(sessionId),
    tournamentService.getSessionMatchViews(sessionId),
    tournamentService.getSessionAnnouncements(sessionId),
    tournamentService.getTournamentState(sessionId),
  ]);

  return {
    ...session,
    participants,
    teams,
    matches,
    announcements,
    tournament: state,
  };
}

// ---------------------------------------------------------------------------
// Équipes
// ---------------------------------------------------------------------------

interface TeamBody {
  tag?: string;
  removeLogo?: boolean;
}

export async function createTeam(
  req: Request<{ id: string }, {}, TeamBody>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  if (sessionId == null) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  const tag = req.body?.tag?.trim();
  if (!tag) {
    res.status(400).json({ error: 'Le tag d’équipe est requis' });
    return;
  }
  try {
    await tournamentService.createTeam(sessionId, tag, logoUrlFromRequest(req));
    const detail = await buildTournamentDetail(sessionId);
    res.status(201).json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

export async function updateTeam(
  req: Request<{ id: string; teamId: string }, {}, TeamBody>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  const teamId = Number(req.params.teamId);
  if (sessionId == null || !Number.isInteger(teamId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  try {
    const updates: { tag?: string; logo_url?: string | null } = {};
    if (req.body?.tag !== undefined) updates.tag = req.body.tag;
    if (req.file) updates.logo_url = logoUrlFromRequest(req);
    else if (req.body?.removeLogo === true) updates.logo_url = null;
    await tournamentService.updateTeam(sessionId, teamId, updates);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

export async function deleteTeam(
  req: Request<{ id: string; teamId: string }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  const teamId = Number(req.params.teamId);
  if (sessionId == null || !Number.isInteger(teamId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  try {
    await tournamentService.deleteTeam(sessionId, teamId);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

export async function addTeamMember(
  req: Request<{ id: string; teamId: string }, {}, { userId?: number }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  const teamId = Number(req.params.teamId);
  const userId = req.body?.userId;
  if (sessionId == null || !Number.isInteger(teamId) || !Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  try {
    await tournamentService.addTeamMember(sessionId, teamId, userId as number);
    const detail = await buildTournamentDetail(sessionId);
    res.status(201).json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

export async function removeTeamMember(
  req: Request<{ id: string; teamId: string; userId: string }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  const teamId = Number(req.params.teamId);
  const userId = Number(req.params.userId);
  if (sessionId == null || !Number.isInteger(teamId) || !Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  try {
    await tournamentService.removeTeamMember(sessionId, teamId, userId);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

// ---------------------------------------------------------------------------
// Inscriptions (rating de pondération)
// ---------------------------------------------------------------------------

export async function setParticipantRating(
  req: Request<{ id: string; userId: string }, {}, { rating?: number | null }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  const userId = Number(req.params.userId);
  if (sessionId == null || !Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  const rawRating = req.body?.rating;
  if (rawRating !== null && rawRating !== undefined && !Number.isInteger(rawRating)) {
    res.status(400).json({ error: 'Le rating doit être un entier ou null' });
    return;
  }
  if (typeof rawRating === 'number' && rawRating < 0) {
    res.status(400).json({ error: 'Le rating doit être positif ou nul' });
    return;
  }
  try {
    await tournamentService.setParticipantRating(sessionId, userId, rawRating ?? null);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

// ---------------------------------------------------------------------------
// Génération des équipes / de l'arbre
// ---------------------------------------------------------------------------

export async function autoGenerateTeams(
  req: Request<{ id: string }, {}, { teamCount?: number }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  if (sessionId == null) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  const teamCount = req.body?.teamCount;
  if (teamCount !== undefined && (!Number.isInteger(teamCount) || (teamCount as number) < 2)) {
    res.status(400).json({ error: 'Le nombre d’équipes doit être un entier ≥ 2' });
    return;
  }
  try {
    await tournamentService.autoGenerateTeams(sessionId, teamCount);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

export async function generateBracket(
  req: Request<{ id: string }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  if (sessionId == null) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  try {
    await tournamentService.generateBracket(sessionId);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

export async function resetBracket(
  req: Request<{ id: string }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  if (sessionId == null) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  try {
    await tournamentService.resetBracket(sessionId);
    const detail = await buildTournamentDetail(sessionId);
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
}

// ---------------------------------------------------------------------------
// Résolution d'un match
// ---------------------------------------------------------------------------

export async function resolveMatch(
  req: Request<{ id: string; matchId: string }, {}, { winnerTeamId?: number }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  const matchId = Number(req.params.matchId);
  const winnerTeamId = req.body?.winnerTeamId;
  if (sessionId == null || !Number.isInteger(matchId) || !Number.isInteger(winnerTeamId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  let result;
  try {
    result = await tournamentService.resolveMatch(sessionId, matchId, winnerTeamId as number);
  } catch (err) {
    handleError(res, err);
    return;
  }

  if (result.awards.length > 0) {
    const [teams, session] = await Promise.all([
      tournamentService.getSessionTeams(sessionId),
      eventService.getSessionById(sessionId),
    ]);
    const teamById = new Map(teams.map((t) => [t.id, t]));
    await Promise.all(
      result.awards.map((a) =>
        notificationService.createNotification({
          userId: a.userId,
          type: 'sp_gained',
          message: `Ton équipe [${teamById.get(a.teamId)?.tag ?? '?'}] a fini ${
            RANK_LABELS[a.rank - 1] ?? `${a.rank}e`
          } au tournoi ${session?.title ?? ''} — +${a.amount} SP`.trim(),
          link: `/evenements/${sessionId}`,
        })
      )
    );
  }

  const detail = await buildTournamentDetail(sessionId);
  res.json(detail);
}

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

export async function createAnnouncement(
  req: Request<{ id: string }, {}, { body?: string }>,
  res: Response
): Promise<void> {
  const sessionId = parseSessionId(req);
  if (sessionId == null) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  const body = req.body?.body?.trim();
  if (!body) {
    res.status(400).json({ error: 'Le texte de l’annonce est requis' });
    return;
  }
  let announcement;
  try {
    announcement = await tournamentService.createAnnouncement(sessionId, req.user!.id, body);
  } catch (err) {
    handleError(res, err);
    return;
  }

  const session = await eventService.getSessionById(sessionId);
  const recipientIds = await tournamentService.listAnnouncementRecipients(sessionId);
  const preview = announcement.body.length > 100 ? `${announcement.body.slice(0, 100)}…` : announcement.body;
  await notificationService.createNotificationsForUsers(
    recipientIds,
    'tournament_announcement',
    `Annonce — ${session?.title ?? 'Tournoi'} : ${preview}`,
    `/evenements/${sessionId}`
  );

  const detail = await buildTournamentDetail(sessionId);
  res.status(201).json(detail);
}
