import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import type { PoolClient, QueryResult } from 'pg';
import { TOURNAMENT_FORMATS } from '../types.js';
import type {
  EventSessionRow,
  TournamentAnnouncementEntry,
  TournamentMatchFeed,
  TournamentMatchRow,
  TournamentMatchView,
  TournamentOverallEntry,
  TournamentStageRow,
  TournamentStagePlacement,
  TournamentStageView,
  TournamentStandingsEntry,
  TournamentTeamEntry,
  TournamentTeamMember,
  TournamentTeamRow,
} from '../types.js';

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function getSessionTeams(sessionId: number): Promise<TournamentTeamRow[]> {
  const { rows } = await pool.query<TournamentTeamRow>(
    'SELECT * FROM tournament_teams WHERE session_id = $1 ORDER BY id ASC',
    [sessionId]
  );
  return rows;
}

export async function getSessionTeamMembers(
  sessionId: number
): Promise<Array<{ team_id: number; user_id: number; username: string; avatar_url: string | null }>> {
  const { rows } = await pool.query<{
    team_id: number;
    user_id: number;
    username: string;
    avatar_url: string | null;
  }>(
    `SELECT m.team_id, m.user_id, u.username, u.avatar_url
     FROM tournament_team_members m
     JOIN tournament_teams t ON t.id = m.team_id
     JOIN users u ON u.id = m.user_id
     WHERE t.session_id = $1
     ORDER BY m.team_id ASC, m.created_at ASC`,
    [sessionId]
  );
  return rows;
}

export async function getSessionTeamsWithMembers(
  sessionId: number
): Promise<TournamentTeamEntry[]> {
  const [teams, members] = await Promise.all([
    getSessionTeams(sessionId),
    getSessionTeamMembers(sessionId),
  ]);
  const membersByTeam = new Map<number, TournamentTeamMember[]>();
  for (const m of members) {
    const list = membersByTeam.get(m.team_id) ?? [];
    list.push({ user_id: m.user_id, username: m.username, avatar_url: m.avatar_url });
    membersByTeam.set(m.team_id, list);
  }
  return teams.map((team) => ({
    ...team,
    members: membersByTeam.get(team.id) ?? [],
  }));
}

export async function getSessionMatches(sessionId: number): Promise<TournamentMatchRow[]> {
  const { rows } = await pool.query<TournamentMatchRow>(
    `SELECT * FROM tournament_matches WHERE session_id = $1
     ORDER BY stage_id ASC,
              CASE bracket WHEN 'main' THEN 0 WHEN 'winners' THEN 1 WHEN 'losers' THEN 2
                WHEN 'grand_final' THEN 3 ELSE 4 END, round ASC, position ASC`,
    [sessionId]
  );
  return rows;
}

export async function getSessionStages(sessionId: number): Promise<TournamentStageRow[]> {
  const { rows } = await pool.query<TournamentStageRow>(
    'SELECT * FROM tournament_stages WHERE session_id = $1 ORDER BY position ASC',
    [sessionId]
  );
  return rows;
}

export async function getSessionMatchViews(sessionId: number): Promise<TournamentMatchView[]> {
  const [matches, teams] = await Promise.all([
    getSessionMatches(sessionId),
    getSessionTeams(sessionId),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const view = (teamId: number | null) => {
    if (teamId == null) return null;
    const t = teamById.get(teamId);
    return t ? { id: t.id, tag: t.tag, logo_url: t.logo_url } : null;
  };
  return matches.map((m) => ({
    ...m,
    team_a: view(m.team_a_id),
    team_b: view(m.team_b_id),
  }));
}

export async function getSessionAnnouncements(
  sessionId: number
): Promise<TournamentAnnouncementEntry[]> {
  const { rows } = await pool.query<TournamentAnnouncementEntry>(
    `SELECT a.*, u.username AS author_username
     FROM tournament_announcements a
     JOIN users u ON u.id = a.author_id
     WHERE a.session_id = $1
     ORDER BY a.created_at DESC`,
    [sessionId]
  );
  return rows;
}

/** IDs des inscrits à notifier (participants de la session, doublons écartés). */
export async function listAnnouncementRecipients(sessionId: number): Promise<number[]> {
  const { rows } = await pool.query<{ user_id: number }>(
    'SELECT DISTINCT user_id FROM event_participants WHERE session_id = $1',
    [sessionId]
  );
  return rows.map((r) => r.user_id);
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

interface QueryableClient {
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>;
}

async function getTournamentSession(sessionId: number): Promise<EventSessionRow> {
  const { rows } = await pool.query<EventSessionRow>(
    'SELECT * FROM event_sessions WHERE id = $1',
    [sessionId]
  );
  const session = rows[0];
  if (!session) {
    throw Object.assign(new Error('Session introuvable'), { status: 404 });
  }
  if (session.game_type !== 'tournament') {
    throw Object.assign(new Error('Cette session n’est pas un tournoi'), { status: 400 });
  }
  return session;
}

function assertOpen(session: EventSessionRow): void {
  if (session.status !== 'open') {
    throw Object.assign(new Error('Cette session est clôturée'), { status: 400 });
  }
}

function assertTeamSizeAndMax(session: EventSessionRow): { teamSize: number; maxTeams: number } {
  const teamSize = session.tournament_team_size ?? 1;
  const maxTeams = session.tournament_max_teams ?? 2;
  return { teamSize, maxTeams };
}

async function assertNoMatches(
  client: QueryableClient,
  sessionId: number
): Promise<void> {
  const { rowCount } = await client.query(
    'SELECT 1 FROM tournament_matches WHERE session_id = $1 LIMIT 1',
    [sessionId]
  );
  if ((rowCount ?? 0) > 0) {
    throw Object.assign(
      new Error('Un arbre a déjà été généré — supprime les arbres (sans match joué) pour modifier les équipes'),
      { status: 400 }
    );
  }
}

interface ParsedFeed {
  kind: 'team' | 'winner' | 'loser';
  ref: number;
}

function parseFeed(feed: TournamentMatchFeed): ParsedFeed | null {
  if (!feed) return null;
  const m = /^([twl]):(\d+)$/.exec(feed);
  if (!m) return null;
  return {
    kind: m[1] === 't' ? 'team' : m[1] === 'w' ? 'winner' : 'loser',
    ref: Number(m[2]),
  };
}

function encodeFeed(kind: 'team' | 'winner' | 'loser', ref: number): string {
  const prefix = kind === 'team' ? 't' : kind === 'winner' ? 'w' : 'l';
  return `${prefix}:${ref}`;
}

interface PendingFeed {
  bracket: 'main' | 'winners' | 'losers' | 'grand_final';
  round: number;
  position: number;
  loser: boolean;
}

/** Feeds temporaires écrits à la génération (les ids des matchs référencés ne
 * sont connus qu'après insertion) — remplacés ensuite par resolvePendingFeeds. */
function parsePendingFeed(feed: TournamentMatchFeed): PendingFeed | null {
  if (!feed || !feed.startsWith('PENDING:')) return null;
  const m = /^PENDING:([a-z_]+):(\d+):(\d+)(:loser)?$/.exec(feed);
  if (!m) return null;
  return {
    bracket: m[1] as PendingFeed['bracket'],
    round: Number(m[2]),
    position: Number(m[3]),
    loser: m[4] === ':loser',
  };
}

/** État d'un slot de match : l'équipe qui l'occupe (ou la recevra) et si le
 * slot est définitivement vide (bye, ou perdant d'un match de bye). */
interface SlotState {
  team: number | null;
  dead: boolean;
}

type LiveMatch = TournamentMatchRow;

function slotState(
  match: LiveMatch,
  side: 'a' | 'b',
  byId: Map<number, LiveMatch>
): SlotState {
  // Une équipe déjà posée dans le slot (round-robin, reset, ou propagation
  // précédente) reste prioritaire sur le feed
  const existing = side === 'a' ? match.team_a_id : match.team_b_id;
  if (existing != null) return { team: existing, dead: false };
  const feed = side === 'a' ? match.feed_a : match.feed_b;
  const parsed = parseFeed(feed);
  if (!parsed) return { team: null, dead: true };
  if (parsed.kind === 'team') return { team: parsed.ref, dead: false };
  const ref = byId.get(parsed.ref);
  if (!ref || !ref.winner_team_id) return { team: null, dead: false };
  if (parsed.kind === 'winner') return { team: ref.winner_team_id, dead: false };
  const loser =
    ref.team_a_id === ref.winner_team_id ? ref.team_b_id : ref.team_a_id;
  return loser != null ? { team: loser, dead: false } : { team: null, dead: true };
}

function matchLoser(match: LiveMatch): number | null {
  if (!match.winner_team_id) return null;
  return match.team_a_id === match.winner_team_id ? match.team_b_id : match.team_a_id;
}

/**
 * Propagation en mémoire : remplit les slots des matchs suivants à partir des
 * feeds, et auto-résout les byes (un slot avec équipe, l'autre définitivement
 * vide). Modifie les objets passés en paramètre.
 */
function propagate(byId: Map<number, LiveMatch>): void {
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const match of byId.values()) {
      if (match.winner_team_id) continue;
      const a = slotState(match, 'a', byId);
      const b = slotState(match, 'b', byId);

      if (a.team != null && b.team != null) {
        if (match.team_a_id !== a.team || match.team_b_id !== b.team) {
          match.team_a_id = a.team;
          match.team_b_id = b.team;
          changed = true;
        }
      } else if (a.team != null && b.dead) {
        // Bye : la seule équipe présente avance automatiquement
        match.team_a_id = a.team;
        match.team_b_id = null;
        match.winner_team_id = a.team;
        match.resolved_at = new Date().toISOString();
        changed = true;
      } else if (b.team != null && a.dead) {
        match.team_a_id = null;
        match.team_b_id = b.team;
        match.winner_team_id = b.team;
        match.resolved_at = new Date().toISOString();
        changed = true;
      } else if (match.team_a_id !== a.team || match.team_b_id !== b.team) {
        match.team_a_id = a.team;
        match.team_b_id = b.team;
        changed = true;
      }
    }
  }
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

interface NewMatchSpec {
  bracket: 'main' | 'winners' | 'losers' | 'grand_final' | 'grand_final_reset';
  round: number;
  position: number;
  feed_a: TournamentMatchFeed;
  feed_b: TournamentMatchFeed;
  team_a_id: number | null;
  team_b_id: number | null;
}

function matchKey(bracket: string, round: number, position: number): string {
  return `${bracket}:${round}:${position}`;
}

/** Écrit en DB les changements (feeds résolus après insertion puis slots/winner
 * de la propagation) — diff avec l'état initial. */
async function persistMatches(
  client: QueryableClient,
  initial: Map<number, LiveMatch>,
  byId: Map<number, LiveMatch>
): Promise<void> {
  for (const [id, live] of byId.entries()) {
    const before = initial.get(id);
    const changed =
      !before ||
      before.feed_a !== live.feed_a ||
      before.feed_b !== live.feed_b ||
      before.team_a_id !== live.team_a_id ||
      before.team_b_id !== live.team_b_id ||
      before.winner_team_id !== live.winner_team_id ||
      before.resolved_at !== live.resolved_at;
    if (!changed) continue;
    await client.query(
      `UPDATE tournament_matches
       SET feed_a = $1, feed_b = $2, team_a_id = $3, team_b_id = $4,
           winner_team_id = $5, resolved_at = $6
       WHERE id = $7`,
      [live.feed_a, live.feed_b, live.team_a_id, live.team_b_id, live.winner_team_id, live.resolved_at, id]
    );
  }
}

// ---------------------------------------------------------------------------
// Équipes
// ---------------------------------------------------------------------------

export async function createTeam(
  sessionId: number,
  tag: string,
  logoUrl: string | null
): Promise<TournamentTeamRow> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);
  const { maxTeams } = assertTeamSizeAndMax(session);

  const client = await pool.connect();
  try {
    await assertNoMatches(client, sessionId);
    const teams = await getSessionTeams(sessionId);
    if (teams.length >= maxTeams) {
      throw Object.assign(new Error(`Ce tournoi est limité à ${maxTeams} équipes`), {
        status: 400,
      });
    }
    const normalized = tag.trim();
    if (normalized.length < 1 || normalized.length > 8) {
      throw Object.assign(new Error('Le tag doit faire entre 1 et 8 caractères'), { status: 400 });
    }
    const { rows } = await client.query<TournamentTeamRow>(
      `INSERT INTO tournament_teams (session_id, tag, logo_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [sessionId, normalized, logoUrl]
    );
    return rows[0]!;
  } finally {
    client.release();
  }
}

export async function updateTeam(
  sessionId: number,
  teamId: number,
  updates: { tag?: string; logo_url?: string | null }
): Promise<TournamentTeamRow | null> {
  await getTournamentSession(sessionId);

  const client = await pool.connect();
  try {
    await assertNoMatches(client, sessionId);
    const { rows: existing } = await client.query<TournamentTeamRow>(
      'SELECT * FROM tournament_teams WHERE id = $1 AND session_id = $2',
      [teamId, sessionId]
    );
    if (!existing[0]) {
      throw Object.assign(new Error('Équipe introuvable'), { status: 404 });
    }

    const tag = updates.tag !== undefined ? updates.tag.trim() : existing[0].tag;
    if (tag.length < 1 || tag.length > 8) {
      throw Object.assign(new Error('Le tag doit faire entre 1 et 8 caractères'), { status: 400 });
    }
    const logoUrl = updates.logo_url !== undefined ? updates.logo_url : existing[0].logo_url;

    const { rows } = await client.query<TournamentTeamRow>(
      `UPDATE tournament_teams SET tag = $1, logo_url = $2
       WHERE id = $3
       RETURNING *`,
      [tag, logoUrl, teamId]
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function deleteTeam(sessionId: number, teamId: number): Promise<void> {
  await getTournamentSession(sessionId);

  const client = await pool.connect();
  try {
    await assertNoMatches(client, sessionId);
    const { rowCount: teamExists } = await client.query(
      'SELECT 1 FROM tournament_teams WHERE id = $1 AND session_id = $2',
      [teamId, sessionId]
    );
    if ((teamExists ?? 0) === 0) {
      throw Object.assign(new Error('Équipe introuvable'), { status: 404 });
    }
    await client.query('DELETE FROM tournament_team_members WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM tournament_teams WHERE id = $1', [teamId]);
  } finally {
    client.release();
  }
}

export async function addTeamMember(
  sessionId: number,
  teamId: number,
  userId: number
): Promise<void> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);
  const { teamSize } = assertTeamSizeAndMax(session);

  const client = await pool.connect();
  try {
    await assertNoMatches(client, sessionId);
    const { rowCount: teamExists } = await client.query(
      'SELECT 1 FROM tournament_teams WHERE id = $1 AND session_id = $2',
      [teamId, sessionId]
    );
    if ((teamExists ?? 0) === 0) {
      throw Object.assign(new Error('Équipe introuvable'), { status: 404 });
    }
    const { rowCount: isParticipant } = await client.query(
      'SELECT 1 FROM event_participants WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    if ((isParticipant ?? 0) === 0) {
      throw Object.assign(
        new Error('Ce joueur doit d’abord s’inscrire au tournoi pour rejoindre une équipe'),
        { status: 400 }
      );
    }
    const { rowCount: teamFull } = await client.query(
      `SELECT 1 FROM tournament_teams t
       WHERE t.id = $1 AND
         (SELECT COUNT(*) FROM tournament_team_members m WHERE m.team_id = t.id) >= $2`,
      [teamId, teamSize]
    );
    if ((teamFull ?? 0) > 0) {
      throw Object.assign(
        new Error(`Cette équipe est complète (max ${teamSize} membres)`),
        { status: 400 }
      );
    }
    const { rowCount: alreadyInTeam } = await client.query(
      `SELECT 1
       FROM tournament_team_members m
       JOIN tournament_teams t ON t.id = m.team_id
       WHERE t.session_id = $1 AND m.user_id = $2`,
      [sessionId, userId]
    );
    if ((alreadyInTeam ?? 0) > 0) {
      throw Object.assign(new Error('Ce joueur est déjà dans une équipe de ce tournoi'), {
        status: 409,
      });
    }
    await client.query(
      'INSERT INTO tournament_team_members (team_id, user_id) VALUES ($1, $2)',
      [teamId, userId]
    );
  } finally {
    client.release();
  }
}

export async function removeTeamMember(
  sessionId: number,
  teamId: number,
  userId: number
): Promise<boolean> {
  await getTournamentSession(sessionId);

  const client = await pool.connect();
  try {
    await assertNoMatches(client, sessionId);
    const { rowCount } = await client.query(
      `DELETE FROM tournament_team_members m
       USING tournament_teams t
       WHERE m.team_id = t.id AND t.session_id = $1 AND m.team_id = $2 AND m.user_id = $3`,
      [sessionId, teamId, userId]
    );
    return (rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Équipes formées par les joueurs (event_sessions.tournament_player_teams)
// ---------------------------------------------------------------------------

/**
 * Ouvre une transaction et verrouille la ligne de session : toutes les
 * mutations d'équipes faites par les joueurs sont ainsi sérialisées par
 * tournoi (deux joueurs ne peuvent pas prendre la dernière place d'une équipe
 * en même temps, ni dépasser le nombre max d'équipes).
 */
async function withPlayerTeamsLock<T>(
  sessionId: number,
  userId: number,
  action: (client: PoolClient, session: EventSessionRow) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<EventSessionRow>(
      'SELECT * FROM event_sessions WHERE id = $1 FOR UPDATE',
      [sessionId]
    );
    const session = rows[0];
    if (!session) {
      throw Object.assign(new Error('Session introuvable'), { status: 404 });
    }
    if (session.game_type !== 'tournament') {
      throw Object.assign(new Error('Cette session n’est pas un tournoi'), { status: 400 });
    }
    assertOpen(session);
    if (!session.tournament_player_teams) {
      throw Object.assign(new Error('Dans ce tournoi, les équipes sont formées par l’organisateur'), {
        status: 403,
      });
    }
    await assertNoMatches(client, sessionId);
    const { rowCount: isParticipant } = await client.query(
      'SELECT 1 FROM event_participants WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    if ((isParticipant ?? 0) === 0) {
      throw Object.assign(new Error('Inscris-toi d’abord au tournoi'), { status: 400 });
    }
    const result = await action(client, session);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('Ce tag est déjà pris dans ce tournoi'), { status: 409 });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getMyTeam(
  client: PoolClient,
  sessionId: number,
  userId: number
): Promise<TournamentTeamRow | null> {
  const { rows } = await client.query<TournamentTeamRow>(
    `SELECT t.* FROM tournament_teams t
     JOIN tournament_team_members m ON m.team_id = t.id
     WHERE t.session_id = $1 AND m.user_id = $2`,
    [sessionId, userId]
  );
  return rows[0] ?? null;
}

function normalizeTag(tag: string): string {
  const normalized = tag.trim();
  if (normalized.length < 1 || normalized.length > 8) {
    throw Object.assign(new Error('Le tag doit faire entre 1 et 8 caractères'), { status: 400 });
  }
  return normalized;
}

function alreadyInTeamError(): Error {
  return Object.assign(new Error('Tu es déjà dans une équipe — quitte-la d’abord'), {
    status: 409,
  });
}

/** Le joueur crée une équipe et en devient le premier membre (capitaine). */
export async function createPlayerTeam(
  sessionId: number,
  userId: number,
  tag: string,
  logoUrl: string | null
): Promise<void> {
  await withPlayerTeamsLock(sessionId, userId, async (client, session) => {
    if (await getMyTeam(client, sessionId, userId)) throw alreadyInTeamError();
    const { maxTeams } = assertTeamSizeAndMax(session);
    const { rows: countRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) FROM tournament_teams WHERE session_id = $1',
      [sessionId]
    );
    if (Number(countRows[0]?.count ?? 0) >= maxTeams) {
      throw Object.assign(new Error(`Ce tournoi est limité à ${maxTeams} équipes`), {
        status: 400,
      });
    }
    const { rows } = await client.query<TournamentTeamRow>(
      `INSERT INTO tournament_teams (session_id, tag, logo_url, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sessionId, normalizeTag(tag), logoUrl, userId]
    );
    await client.query('INSERT INTO tournament_team_members (team_id, user_id) VALUES ($1, $2)', [
      rows[0]!.id,
      userId,
    ]);
  });
}

export async function joinTeamAsPlayer(
  sessionId: number,
  teamId: number,
  userId: number
): Promise<void> {
  await withPlayerTeamsLock(sessionId, userId, async (client, session) => {
    if (await getMyTeam(client, sessionId, userId)) throw alreadyInTeamError();
    const { rows } = await client.query<{ member_count: string }>(
      `SELECT (SELECT COUNT(*) FROM tournament_team_members m WHERE m.team_id = t.id) AS member_count
       FROM tournament_teams t
       WHERE t.id = $1 AND t.session_id = $2`,
      [teamId, sessionId]
    );
    if (!rows[0]) {
      throw Object.assign(new Error('Équipe introuvable'), { status: 404 });
    }
    const { teamSize } = assertTeamSizeAndMax(session);
    if (Number(rows[0].member_count) >= teamSize) {
      throw Object.assign(new Error(`Cette équipe est complète (max ${teamSize} membres)`), {
        status: 400,
      });
    }
    await client.query('INSERT INTO tournament_team_members (team_id, user_id) VALUES ($1, $2)', [
      teamId,
      userId,
    ]);
  });
}

/**
 * Le joueur quitte son équipe. Une équipe créée par un joueur disparaît avec
 * son dernier membre (une équipe vide bloquerait la génération de l'arbre) ;
 * une équipe créée par le MSP/organisateur reste en place, même vide.
 */
export async function leaveTeamAsPlayer(sessionId: number, userId: number): Promise<void> {
  await withPlayerTeamsLock(sessionId, userId, async (client) => {
    const team = await getMyTeam(client, sessionId, userId);
    if (!team) {
      throw Object.assign(new Error('Tu n’es dans aucune équipe'), { status: 400 });
    }
    await client.query('DELETE FROM tournament_team_members WHERE team_id = $1 AND user_id = $2', [
      team.id,
      userId,
    ]);
    if (team.created_by != null) {
      await client.query(
        `DELETE FROM tournament_teams t
         WHERE t.id = $1
           AND NOT EXISTS (SELECT 1 FROM tournament_team_members m WHERE m.team_id = t.id)`,
        [team.id]
      );
    }
  });
}

/** Le capitaine (créateur, toujours membre) renomme son équipe ou change son logo. */
export async function updateTeamAsCaptain(
  sessionId: number,
  userId: number,
  updates: { tag?: string; logo_url?: string | null }
): Promise<void> {
  await withPlayerTeamsLock(sessionId, userId, async (client) => {
    const team = await getMyTeam(client, sessionId, userId);
    if (!team || team.created_by !== userId) {
      throw Object.assign(new Error('Seul le capitaine peut modifier l’équipe'), { status: 403 });
    }
    const tag = updates.tag !== undefined ? normalizeTag(updates.tag) : team.tag;
    const logoUrl = updates.logo_url !== undefined ? updates.logo_url : team.logo_url;
    await client.query('UPDATE tournament_teams SET tag = $1, logo_url = $2 WHERE id = $3', [
      tag,
      logoUrl,
      team.id,
    ]);
  });
}

export async function setParticipantRating(
  sessionId: number,
  userId: number,
  rating: number | null
): Promise<boolean> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);

  const { rowCount } = await pool.query(
    'UPDATE event_participants SET rating = $1 WHERE session_id = $2 AND user_id = $3',
    [rating, sessionId, userId]
  );
  if ((rowCount ?? 0) === 0) {
    throw Object.assign(new Error('Participant introuvable'), { status: 404 });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Génération automatique des équipes (serpentin pondéré)
// ---------------------------------------------------------------------------

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export async function autoGenerateTeams(
  sessionId: number,
  teamCountInput?: number
): Promise<TournamentTeamEntry[]> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);
  const { teamSize } = assertTeamSizeAndMax(session);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertNoMatches(client, sessionId);

    const { rows: participants } = await client.query<{ user_id: number }>(
      'SELECT user_id FROM event_participants WHERE session_id = $1 ORDER BY joined_at ASC',
      [sessionId]
    );
    if (participants.length < 2) {
      throw Object.assign(new Error('Il faut au moins 2 inscrits pour générer des équipes'), {
        status: 400,
      });
    }

    // Nombre d'équipes : fourni par le MSP, sinon la taille d'arbre prévue,
    // sinon le minimum qui fait tenir tout le monde
    const teamCount = Math.max(
      2,
      teamCountInput ?? session.tournament_max_teams ?? Math.ceil(participants.length / teamSize)
    );
    if (participants.length > teamCount * teamSize) {
      throw Object.assign(
        new Error(
          `${teamCount} équipes de ${teamSize} ne suffisent pas pour ${participants.length} inscrits`
        ),
        { status: 400 }
      );
    }

    // Écrase les équipes existantes (aucun match n'existe, cf. assertNoMatches)
    await client.query(
      `DELETE FROM tournament_team_members m
       USING tournament_teams t
       WHERE m.team_id = t.id AND t.session_id = $1`,
      [sessionId]
    );
    await client.query('DELETE FROM tournament_teams WHERE session_id = $1', [sessionId]);

    // Rating effectif : rating édité par le MSP, sinon solde SP actuel
    const { rows: rated } = await client.query<{ user_id: number; effective_rating: number }>(
      `SELECT p.user_id,
              COALESCE(p.rating, u.sp_balance)::int AS effective_rating
       FROM event_participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.session_id = $1`,
      [sessionId]
    );

    // Bucket shuffle : mélange les ex-aequos pour que deux générations
    // successives diffèrent, puis tri par rating décroissant
    const byRating = new Map<number, number[]>();
    for (const p of rated) {
      const bucket = byRating.get(p.effective_rating) ?? [];
      bucket.push(p.user_id);
      byRating.set(p.effective_rating, bucket);
    }
    const ordered: number[] = [];
    for (const rating of [...byRating.keys()].sort((x, y) => y - x)) {
      ordered.push(...shuffle(byRating.get(rating) ?? []));
    }

    // Distribution en serpentin : 1re → 2e → … → n-ième → (n-1)-ième → … → 1re
    const teamsPlayers: number[][] = Array.from({ length: teamCount }, () => []);
    ordered.forEach((userId, idx) => {
      const cycle = teamCount * 2;
      const pos = idx % cycle;
      const teamIdx = pos < teamCount ? pos : cycle - 1 - pos;
      teamsPlayers[teamIdx]!.push(userId);
    });

    const createdTeams: TournamentTeamEntry[] = [];
    for (let i = 0; i < teamCount; i++) {
      const { rows } = await client.query<TournamentTeamRow>(
        `INSERT INTO tournament_teams (session_id, tag)
         VALUES ($1, $2)
         RETURNING *`,
        [sessionId, `T${i + 1}`]
      );
      const team = rows[0]!;
      const members: TournamentTeamMember[] = [];
      for (const userId of teamsPlayers[i]!) {
        await client.query(
          'INSERT INTO tournament_team_members (team_id, user_id) VALUES ($1, $2)',
          [team.id, userId]
        );
        const { rows: userRows } = await client.query<{
          username: string;
          avatar_url: string | null;
        }>('SELECT username, avatar_url FROM users WHERE id = $1', [userId]);
        members.push({
          user_id: userId,
          username: userRows[0]?.username ?? '',
          avatar_url: userRows[0]?.avatar_url ?? null,
        });
      }
      createdTeams.push({ ...team, members });
    }

    await client.query('COMMIT');
    return createdTeams;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Génération de l'arbre
// ---------------------------------------------------------------------------

/**
 * Crée un nouvel arbre (toutes les équipes du tournoi, mêmes membres) et
 * génère tous ses matchs d'un coup. Le premier arbre seed par ordre de
 * création des équipes ; les suivants par classement général courant (points
 * décroissants, puis ordre de création), pour que le score déjà acquis compte.
 */
export async function createStage(
  sessionId: number,
  options: { name?: string; format?: string } = {}
): Promise<TournamentStageRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou de session : sérialise les créations d'arbre (position) et les
    // mutations d'équipes faites par les joueurs (voir withPlayerTeamsLock)
    const { rows: sessionRows } = await client.query<EventSessionRow>(
      'SELECT * FROM event_sessions WHERE id = $1 FOR UPDATE',
      [sessionId]
    );
    const session = sessionRows[0];
    if (!session) {
      throw Object.assign(new Error('Session introuvable'), { status: 404 });
    }
    if (session.game_type !== 'tournament') {
      throw Object.assign(new Error('Cette session n’est pas un tournoi'), { status: 400 });
    }
    assertOpen(session);
    assertNotFinished(session);

    const format = options.format ?? session.tournament_format ?? 'single_elim';
    if (!(TOURNAMENT_FORMATS as readonly string[]).includes(format)) {
      throw Object.assign(new Error('Format d’arbre invalide'), { status: 400 });
    }

    const teams = await getSessionTeams(sessionId);
    if (teams.length < 2) {
      throw Object.assign(new Error('Il faut au moins 2 équipes pour générer l’arbre'), {
        status: 400,
      });
    }

    const members = await getSessionTeamMembers(sessionId);
    const memberCountByTeam = new Map<number, number>();
    for (const m of members) {
      memberCountByTeam.set(m.team_id, (memberCountByTeam.get(m.team_id) ?? 0) + 1);
    }
    const emptyTeams = teams.filter((t) => (memberCountByTeam.get(t.id) ?? 0) === 0);
    if (emptyTeams.length > 0) {
      throw Object.assign(
        new Error(
          `L’équipe ${emptyTeams[0]!.tag} est vide — complète-la ou supprime-la avant de générer l’arbre`
        ),
        { status: 400 }
      );
    }

    const { rows: existingStages } = await client.query<TournamentStageRow>(
      'SELECT * FROM tournament_stages WHERE session_id = $1 ORDER BY position ASC',
      [sessionId]
    );
    const position = Math.max(0, ...existingStages.map((st) => st.position)) + 1;
    const name = options.name?.trim() || `Arbre ${position}`;
    if (name.length > 100) {
      throw Object.assign(new Error('Le nom de l’arbre ne doit pas dépasser 100 caractères'), {
        status: 400,
      });
    }

    // Seed : ordre de création, sauf si des arbres terminés donnent déjà des points
    let seeded = [...teams].sort((a, b) => a.id - b.id);
    if (existingStages.length > 0) {
      const { rows: previousMatches } = await client.query<LiveMatch>(
        'SELECT * FROM tournament_matches WHERE session_id = $1',
        [sessionId]
      );
      const overall = computeOverallStandings(session, existingStages, previousMatches, teams);
      const pointsByTeam = new Map(overall.map((o) => [o.team_id, o.points]));
      seeded = seeded.sort(
        (a, b) => (pointsByTeam.get(b.id) ?? 0) - (pointsByTeam.get(a.id) ?? 0) || a.id - b.id
      );
    }

    const { rows: stageRows } = await client.query<TournamentStageRow>(
      `INSERT INTO tournament_stages (session_id, name, format, position)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sessionId, name, format, position]
    );
    const stage = stageRows[0]!;

    let specs: NewMatchSpec[];
    if (format === 'round_robin') {
      specs = buildRoundRobinSpecs(seeded);
    } else {
      const p = nextPowerOfTwo(seeded.length);
      // Élimination simple : bracket 'main'. Double : le socle s'appelle
      // 'winners' (le bracket 'losers' lui fait face).
      const elimBracket = format === 'double_elim' ? 'winners' : 'main';
      specs = buildElimSpecs(seeded, p, elimBracket);
      if (format === 'double_elim') {
        specs = specs.concat(buildLosersSpecs(p), buildGrandFinalSpecs(p));
      }
    }

    // Insertion : les feeds entre matchs utilisent des placeholders PENDING,
    // remplacés par les vrais ids une fois tous les matchs insérés
    const ids = new Map<string, number>();
    for (const spec of specs) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO tournament_matches
           (session_id, stage_id, bracket, round, position, feed_a, feed_b, team_a_id, team_b_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          sessionId,
          stage.id,
          spec.bracket,
          spec.round,
          spec.position,
          spec.feed_a,
          spec.feed_b,
          spec.team_a_id,
          spec.team_b_id,
        ]
      );
      ids.set(matchKey(spec.bracket, spec.round, spec.position), rows[0]!.id);
    }

    const { rows: inserted } = await client.query<LiveMatch>(
      'SELECT * FROM tournament_matches WHERE stage_id = $1 ORDER BY id ASC',
      [stage.id]
    );
    const initial = new Map(inserted.map((m) => [m.id, { ...m }]));
    const byId = new Map(inserted.map((m) => [m.id, m]));

    // Remappage des placeholders → feeds réels ('w:<id>' / 'l:<id>')
    for (const match of byId.values()) {
      for (const side of ['a', 'b'] as const) {
        const pending = parsePendingFeed(side === 'a' ? match.feed_a : match.feed_b);
        if (!pending) continue;
        const refId = ids.get(matchKey(pending.bracket, pending.round, pending.position));
        if (refId == null) {
          throw Object.assign(new Error('Erreur interne : feed d’arbre introuvable'), {
            status: 500,
          });
        }
        const resolved = encodeFeed(pending.loser ? 'loser' : 'winner', refId);
        if (side === 'a') match.feed_a = resolved;
        else match.feed_b = resolved;
      }
    }

    propagate(byId);
    await persistMatches(client, initial, byId);

    await client.query('COMMIT');
    return stage;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Élimination simple (et bracket winners de la double). Serpentin classique :
 * seed 1 vs seed P, seed 2 vs seed P-1… Les seeds manquants (P > n) sont des
 * byes (feed NULL). Les rounds suivants reçoivent les vainqueurs. */
function buildElimSpecs(
  teams: TournamentTeamRow[],
  p: number,
  bracket: 'main' | 'winners'
): NewMatchSpec[] {
  const specs: NewMatchSpec[] = [];
  const totalRounds = Math.log2(p);
  const teamBySeed = new Map<number, number>();
  teams.forEach((t, idx) => teamBySeed.set(idx + 1, t.id));

  for (let round = 1; round <= totalRounds; round++) {
    const matchCount = p / Math.pow(2, round);
    for (let pos = 1; pos <= matchCount; pos++) {
      let feedA: TournamentMatchFeed = null;
      let feedB: TournamentMatchFeed = null;
      if (round === 1) {
        const seedA = 2 * pos - 1;
        const seedB = p + 1 - seedA; // serpentin
        feedA = teamBySeed.has(seedA) ? encodeFeed('team', teamBySeed.get(seedA)!) : null;
        feedB = teamBySeed.has(seedB) ? encodeFeed('team', teamBySeed.get(seedB)!) : null;
      } else {
        feedA = `PENDING:${bracket}:${round - 1}:${2 * pos - 1}`;
        feedB = `PENDING:${bracket}:${round - 1}:${2 * pos}`;
      }
      specs.push({
        bracket,
        round,
        position: pos,
        feed_a: feedA,
        feed_b: feedB,
        team_a_id: null,
        team_b_id: null,
      });
    }
  }
  return specs;
}

/** Bracket losers de la double élimination : rounds mineurs (impairs) qui
 * reçoivent les perdants du bracket winners par paires adjacentes, rounds
 * majeurs (pairs) où les survivants s'affrontent. Le perdant de la finale
 * winners entre directement dans la finale losers (dernier round). */
function buildLosersSpecs(p: number): NewMatchSpec[] {
  const specs: NewMatchSpec[] = [];
  const k = Math.log2(p);
  if (k < 2) return specs; // 2 équipes : pas de bracket losers

  if (k === 2) {
    // 4 équipes : structure minimale — les 2 perdants du WB round 1
    // s'affrontent, puis le survivant rencontre le perdant de la finale WB
    specs.push({
      bracket: 'losers',
      round: 1,
      position: 1,
      feed_a: 'PENDING:winners:1:1:loser',
      feed_b: 'PENDING:winners:1:2:loser',
      team_a_id: null,
      team_b_id: null,
    });
    specs.push({
      bracket: 'losers',
      round: 2,
      position: 1,
      feed_a: 'PENDING:losers:1:1',
      feed_b: 'PENDING:winners:2:1:loser',
      team_a_id: null,
      team_b_id: null,
    });
    return specs;
  }

  for (let r = 1; r <= k - 2; r++) {
    // minor round 2r-1 : les perdants du WB round r, par paires adjacentes
    const minorRound = 2 * r - 1;
    const matchCount = p / Math.pow(2, r + 1);
    for (let pos = 1; pos <= matchCount; pos++) {
      specs.push({
        bracket: 'losers',
        round: minorRound,
        position: pos,
        feed_a: `PENDING:winners:${r}:${2 * pos - 1}:loser`,
        feed_b: `PENDING:winners:${r}:${2 * pos}:loser`,
        team_a_id: null,
        team_b_id: null,
      });
    }
    // major round 2r : les survivants du minor précédent
    const majorRound = 2 * r;
    const majorCount = Math.max(1, p / Math.pow(2, r + 2));
    for (let pos = 1; pos <= majorCount; pos++) {
      specs.push({
        bracket: 'losers',
        round: majorRound,
        position: pos,
        feed_a: `PENDING:losers:${minorRound}:${2 * pos - 1}`,
        feed_b: `PENDING:losers:${minorRound}:${2 * pos}`,
        team_a_id: null,
        team_b_id: null,
      });
    }
  }

  // Dernier minor (2k-3) : perdant du WB round k-1 + survivant du major 2k-4
  const lastMinor = 2 * k - 3;
  specs.push({
    bracket: 'losers',
    round: lastMinor,
    position: 1,
    feed_a: `PENDING:winners:${k - 1}:1:loser`,
    feed_b: `PENDING:losers:${2 * k - 4}:1`,
    team_a_id: null,
    team_b_id: null,
  });
  // Finale losers (2k-2) : gagnant du dernier minor + perdant de la finale WB
  specs.push({
    bracket: 'losers',
    round: 2 * k - 2,
    position: 1,
    feed_a: `PENDING:losers:${lastMinor}:1`,
    feed_b: `PENDING:winners:${k}:1:loser`,
    team_a_id: null,
    team_b_id: null,
  });
  return specs;
}

/** Grande finale de la double : champion WB vs champion LB (ou, à 2 équipes,
 * vainqueur vs perdant du seul match WB — vrai double : le perdant doit gagner
 * deux fois pour remporter le tournoi). */
function buildGrandFinalSpecs(p: number): NewMatchSpec[] {
  const k = Math.log2(p);
  const feedB = k >= 2 ? `PENDING:losers:${2 * k - 2}:1` : `PENDING:winners:1:1:loser`;
  return [
    {
      bracket: 'grand_final',
      round: 1,
      position: 1,
      feed_a: `PENDING:winners:${k}:1`,
      feed_b: feedB,
      team_a_id: null,
      team_b_id: null,
    },
  ];
}

/** Round-robin (méthode du cercle / tables de Berger) : N-1 journées (N pair)
 * ou N journées avec un bye (N impair), N/2 matchs par journée. */
function buildRoundRobinSpecs(teams: TournamentTeamRow[]): NewMatchSpec[] {
  const specs: NewMatchSpec[] = [];
  const list: (TournamentTeamRow | null)[] = [...teams];
  if (list.length % 2 === 1) list.push(null); // bye fictif
  const rounds = list.length - 1;

  for (let round = 1; round <= rounds; round++) {
    let pos = 0;
    for (let i = 0; i < list.length / 2; i++) {
      const a = list[i];
      const b = list[list.length - 1 - i];
      if (a && b) {
        pos++;
        specs.push({
          bracket: 'main',
          round,
          position: pos,
          feed_a: null,
          feed_b: null,
          team_a_id: a.id,
          team_b_id: b.id,
        });
      }
    }
    // rotation berger : le premier est fixe, les autres tournent d'un cran
    const fixed = list[0] ?? null;
    const last = list[list.length - 1] ?? null;
    list.splice(0, list.length, fixed, last, ...list.slice(1, list.length - 1));
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Suppression d'un arbre (aucun match résolu uniquement)
// ---------------------------------------------------------------------------

export async function deleteStage(sessionId: number, stageId: number): Promise<void> {
  const session = await getTournamentSession(sessionId);
  assertNotFinished(session);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: stageExists } = await client.query(
      'SELECT 1 FROM tournament_stages WHERE id = $1 AND session_id = $2 FOR UPDATE',
      [stageId, sessionId]
    );
    if ((stageExists ?? 0) === 0) {
      throw Object.assign(new Error('Arbre introuvable'), { status: 404 });
    }
    // Un bye auto-résolu n'est pas un match joué : seuls les matchs à deux équipes comptent
    const { rowCount: played } = await client.query(
      `SELECT 1 FROM tournament_matches
       WHERE stage_id = $1 AND winner_team_id IS NOT NULL
         AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
       LIMIT 1`,
      [stageId]
    );
    if ((played ?? 0) > 0) {
      throw Object.assign(
        new Error('Impossible de supprimer cet arbre : au moins un match a déjà été joué'),
        { status: 400 }
      );
    }
    await client.query('DELETE FROM tournament_matches WHERE stage_id = $1', [stageId]);
    await client.query('DELETE FROM tournament_stages WHERE id = $1', [stageId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function assertNotFinished(session: EventSessionRow): void {
  if (session.tournament_finished_at) {
    throw Object.assign(new Error('Ce tournoi est terminé'), { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// Résolution d'un match + propagation (dans son arbre)
// ---------------------------------------------------------------------------

export interface ResolveMatchResult {
  stageFinished: boolean;
}

export async function resolveMatch(
  sessionId: number,
  matchId: number,
  winnerTeamId: number
): Promise<ResolveMatchResult> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);
  assertNotFinished(session);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: target } = await client.query<{ stage_id: number; format: string }>(
      `SELECT m.stage_id, st.format
       FROM tournament_matches m
       JOIN tournament_stages st ON st.id = m.stage_id
       WHERE m.id = $1 AND m.session_id = $2`,
      [matchId, sessionId]
    );
    if (!target[0]) {
      throw Object.assign(new Error('Match introuvable'), { status: 404 });
    }
    const { stage_id: stageId, format } = target[0];

    const { rows: allRows } = await client.query<LiveMatch>(
      'SELECT * FROM tournament_matches WHERE stage_id = $1 ORDER BY id ASC FOR UPDATE',
      [stageId]
    );
    const initial = new Map(allRows.map((m) => [m.id, { ...m }]));
    const byId = new Map(allRows.map((m) => [m.id, m]));
    const match = byId.get(matchId)!;
    if (match.winner_team_id) {
      throw Object.assign(new Error('Ce match a déjà été joué'), { status: 400 });
    }
    if (match.team_a_id == null || match.team_b_id == null) {
      throw Object.assign(
        new Error('Les deux équipes ne sont pas encore connues pour ce match'),
        { status: 400 }
      );
    }
    if (winnerTeamId !== match.team_a_id && winnerTeamId !== match.team_b_id) {
      throw Object.assign(
        new Error('Le vainqueur doit être l’une des deux équipes du match'),
        { status: 400 }
      );
    }

    match.winner_team_id = winnerTeamId;
    match.resolved_at = new Date().toISOString();

    // Double élimination : si le représentant de la bracket losers gagne la
    // grande finale, le champion WB doit être battu une deuxième fois — le
    // match de reset est créé immédiatement (les deux équipes y sont posées).
    if (format === 'double_elim' && match.bracket === 'grand_final') {
      const feedB = parseFeed(match.feed_b);
      const lbSideTeam =
        feedB && feedB.kind === 'winner'
          ? byId.get(feedB.ref)?.winner_team_id
          : feedB && feedB.kind === 'loser'
            ? matchLoser(byId.get(feedB.ref) ?? match)
            : null;
      if (lbSideTeam === winnerTeamId) {
        const { rows: resetRows } = await client.query<LiveMatch>(
          `INSERT INTO tournament_matches
             (session_id, stage_id, bracket, round, position, feed_a, feed_b, team_a_id, team_b_id)
           VALUES ($1, $2, 'grand_final_reset', 1, 1, $3, $4, $5, $6)
           RETURNING *`,
          [
            sessionId,
            stageId,
            encodeFeed('winner', match.id),
            encodeFeed('loser', match.id),
            match.winner_team_id,
            matchLoser(match),
          ]
        );
        const reset = resetRows[0]!;
        byId.set(reset.id, reset);
      }
    }

    propagate(byId);
    await persistMatches(client, initial, byId);

    // La dotation n'est plus versée à la fin d'un arbre : seulement quand le
    // MSP termine le tournoi (classement général, voir finishTournament)
    const stageFinished = isTournamentFinished(format, byId);
    if (stageFinished) {
      await client.query(
        'UPDATE tournament_stages SET finished_at = NOW() WHERE id = $1 AND finished_at IS NULL',
        [stageId]
      );
    }

    await client.query('COMMIT');
    return { stageFinished };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function isTournamentFinished(format: string, byId: Map<number, LiveMatch>): boolean {
  const all = [...byId.values()];
  if (all.length === 0) return false;
  if (format === 'round_robin') {
    return all.every((m) => m.winner_team_id != null);
  }
  if (format === 'double_elim') {
    const reset = all.find((m) => m.bracket === 'grand_final_reset');
    if (reset) return reset.winner_team_id != null;
    const gf = all.find((m) => m.bracket === 'grand_final');
    if (!gf || !gf.winner_team_id) return false;
    // Fini seulement si le vainqueur de la grande finale vient du side WB :
    // sinon le match de reset sera créé et le tournoi continue.
    const feedA = parseFeed(gf.feed_a);
    return feedA != null && byId.get(feedA.ref)?.winner_team_id === gf.winner_team_id;
  }
  // single elim : le match du dernier round du bracket main
  const main = all.filter((m) => m.bracket === 'main');
  const maxRound = Math.max(...main.map((m) => m.round));
  const final = main.find((m) => m.round === maxRound);
  return final != null && final.winner_team_id != null;
}

/**
 * Placement complet de toutes les équipes d'un arbre terminé (1 = champion).
 * Éliminations : une équipe est classée selon le tour où elle a été éliminée
 * (plus tard = mieux) ; les éliminés d'un même tour sont ex-aequo — ex. en
 * élimination directe à 8 : 1, 2, 3, 3, 5, 5, 5, 5. Round-robin : ordre du
 * classement (victoires puis seed, pas d'ex-aequo — même règle que l'affichage).
 */
function computeStagePlacements(
  format: string,
  byId: Map<number, LiveMatch>
): Map<number, number> {
  const all = [...byId.values()];
  if (format === 'round_robin') {
    const standings = computeRoundRobinStandings(byId);
    return new Map(standings.map((st, idx) => [st.team_id, idx + 1]));
  }

  // Clé d'élimination par équipe : plus elle est grande, mieux l'équipe a fini
  const key = new Map<number, number>();
  const teamIds = new Set<number>();
  for (const m of all) {
    if (m.team_a_id != null) teamIds.add(m.team_a_id);
    if (m.team_b_id != null) teamIds.add(m.team_b_id);
  }

  if (format === 'double_elim') {
    // Toute élimination se fait en bracket losers, sauf la finale décisive
    const losers = all.filter((m) => m.bracket === 'losers');
    const maxLb = Math.max(0, ...losers.map((m) => m.round));
    for (const m of losers) {
      const loser = matchLoser(m);
      if (loser != null) key.set(loser, m.round);
    }
    const decisive =
      all.find((m) => m.bracket === 'grand_final_reset') ??
      all.find((m) => m.bracket === 'grand_final');
    if (decisive?.winner_team_id) {
      const loser = matchLoser(decisive);
      if (loser != null) key.set(loser, maxLb + 1);
      key.set(decisive.winner_team_id, maxLb + 2);
    }
  } else {
    const main = all.filter((m) => m.bracket === 'main');
    const maxRound = Math.max(0, ...main.map((m) => m.round));
    for (const m of main) {
      const loser = matchLoser(m);
      if (loser != null) key.set(loser, m.round);
    }
    const final = main.find((m) => m.round === maxRound);
    if (final?.winner_team_id) key.set(final.winner_team_id, maxRound + 1);
  }

  const keys = [...teamIds].map((id) => key.get(id) ?? 0);
  const places = new Map<number, number>();
  for (const id of teamIds) {
    const k = key.get(id) ?? 0;
    places.set(id, 1 + keys.filter((other) => other > k).length);
  }
  return places;
}

function pointsForPlace(session: EventSessionRow, place: number): number {
  const scale = Array.isArray(session.tournament_placement_points)
    ? session.tournament_placement_points
    : [];
  const value = scale[place - 1];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function groupMatchesByStage(matches: LiveMatch[]): Map<number, Map<number, LiveMatch>> {
  const byStage = new Map<number, Map<number, LiveMatch>>();
  for (const m of matches) {
    const map = byStage.get(m.stage_id) ?? new Map<number, LiveMatch>();
    map.set(m.id, m);
    byStage.set(m.stage_id, map);
  }
  return byStage;
}

/**
 * Classement général : somme des points de placement sur les arbres terminés,
 * rang "compétition" (ex-aequo = même rang, le suivant saute : 1, 1, 3…).
 * Départage d'affichage par ordre de création des équipes.
 */
function computeOverallStandings(
  session: EventSessionRow,
  stages: TournamentStageRow[],
  matches: LiveMatch[],
  teams: TournamentTeamRow[]
): TournamentOverallEntry[] {
  const byStage = groupMatchesByStage(matches);
  const points = new Map<number, number>(teams.map((t) => [t.id, 0]));
  const places = new Map<number, Record<number, number>>(teams.map((t) => [t.id, {}]));

  for (const stage of stages) {
    const stageMatches = byStage.get(stage.id);
    if (!stageMatches || !isTournamentFinished(stage.format, stageMatches)) continue;
    for (const [teamId, place] of computeStagePlacements(stage.format, stageMatches)) {
      if (!points.has(teamId)) continue;
      points.set(teamId, (points.get(teamId) ?? 0) + pointsForPlace(session, place));
      places.get(teamId)![stage.id] = place;
    }
  }

  const sorted = [...teams].sort(
    (a, b) => (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0) || a.id - b.id
  );
  return sorted.map((team) => {
    const total = points.get(team.id) ?? 0;
    return {
      team_id: team.id,
      tag: team.tag,
      logo_url: team.logo_url,
      points: total,
      rank: 1 + sorted.filter((other) => (points.get(other.id) ?? 0) > total).length,
      places: places.get(team.id) ?? {},
    };
  });
}

/** Classement round-robin : victoires décroissantes, départage par seed
 * (ordre de création des équipes). tag/logo enrichis par le contrôleur. */
export function computeRoundRobinStandings(
  byId: Map<number, LiveMatch>
): TournamentStandingsEntry[] {
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  const order: number[] = [];
  for (const m of byId.values()) {
    if (m.bracket !== 'main') continue;
    for (const id of [m.team_a_id, m.team_b_id]) {
      if (id != null && !wins.has(id)) {
        wins.set(id, 0);
        losses.set(id, 0);
        order.push(id);
      }
    }
    if (m.winner_team_id != null) {
      wins.set(m.winner_team_id, (wins.get(m.winner_team_id) ?? 0) + 1);
      const loser = matchLoser(m);
      if (loser != null) losses.set(loser, (losses.get(loser) ?? 0) + 1);
    }
  }
  const sorted = [...order].sort((a, b) => {
    const w = (wins.get(b) ?? 0) - (wins.get(a) ?? 0);
    return w !== 0 ? w : a - b;
  });
  const finished = [...byId.values()].every((m) => m.winner_team_id != null);
  return sorted.map((teamId, idx) => ({
    team_id: teamId,
    tag: '',
    logo_url: null,
    wins: wins.get(teamId) ?? 0,
    losses: losses.get(teamId) ?? 0,
    rank: finished ? idx + 1 : null,
  }));
}

/** État global du tournoi pour la vue détail : arbres (matchs, classement,
 * placements), classement général et fin du tournoi. */
export async function getTournamentState(sessionId: number): Promise<{
  bracketGenerated: boolean;
  finished: boolean;
  championTeamId: number | null;
  stages: TournamentStageView[];
  overall: TournamentOverallEntry[];
}> {
  const [session, stages, matches, teams] = await Promise.all([
    getTournamentSession(sessionId),
    getSessionStages(sessionId),
    getSessionMatches(sessionId),
    getSessionTeams(sessionId),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const byStage = groupMatchesByStage(matches);

  const stageViews: TournamentStageView[] = stages.map((stage) => {
    const stageMatches = byStage.get(stage.id) ?? new Map<number, LiveMatch>();
    const finished = stageMatches.size > 0 && isTournamentFinished(stage.format, stageMatches);
    const standings =
      stage.format === 'round_robin'
        ? computeRoundRobinStandings(stageMatches).map((st) => {
            const team = teamById.get(st.team_id);
            return { ...st, tag: team?.tag ?? '', logo_url: team?.logo_url ?? null };
          })
        : [];
    const placements: TournamentStagePlacement[] = finished
      ? [...computeStagePlacements(stage.format, stageMatches)]
          .map(([team_id, place]) => ({ team_id, place, points: pointsForPlace(session, place) }))
          .sort((a, b) => a.place - b.place)
      : [];
    return { ...stage, finished, standings, placements };
  });

  const overall = computeOverallStandings(session, stages, matches, teams);
  const finished = session.tournament_finished_at != null;
  return {
    bracketGenerated: stages.length > 0,
    finished,
    championTeamId: finished ? (overall[0]?.team_id ?? null) : null,
    stages: stageViews,
    overall,
  };
}

// ---------------------------------------------------------------------------
// Fin du tournoi : dotation sur le classement général
// ---------------------------------------------------------------------------

export interface FinishTournamentResult {
  awards: Array<{ userId: number; amount: number; rank: number; teamId: number }>;
}

/**
 * Termine le tournoi et verse la dotation reward_1st/2nd/3rd (SP par membre)
 * aux équipes classées 1re/2e/3e du classement général — les ex-aequo
 * touchent chacun la dotation de leur rang commun. Exige au moins un arbre
 * et que tous les arbres soient terminés.
 */
export async function finishTournament(sessionId: number): Promise<FinishTournamentResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sessionRows } = await client.query<EventSessionRow>(
      'SELECT * FROM event_sessions WHERE id = $1 FOR UPDATE',
      [sessionId]
    );
    const session = sessionRows[0];
    if (!session) {
      throw Object.assign(new Error('Session introuvable'), { status: 404 });
    }
    if (session.game_type !== 'tournament') {
      throw Object.assign(new Error('Cette session n’est pas un tournoi'), { status: 400 });
    }
    assertOpen(session);
    assertNotFinished(session);

    const { rows: stages } = await client.query<TournamentStageRow>(
      'SELECT * FROM tournament_stages WHERE session_id = $1 ORDER BY position ASC',
      [sessionId]
    );
    if (stages.length === 0) {
      throw Object.assign(new Error('Aucun arbre n’a encore été joué'), { status: 400 });
    }
    const { rows: matches } = await client.query<LiveMatch>(
      'SELECT * FROM tournament_matches WHERE session_id = $1',
      [sessionId]
    );
    const byStage = groupMatchesByStage(matches);
    const unfinished = stages.find((stage) => {
      const stageMatches = byStage.get(stage.id);
      return !stageMatches || !isTournamentFinished(stage.format, stageMatches);
    });
    if (unfinished) {
      throw Object.assign(
        new Error(`L’arbre « ${unfinished.name} » n’est pas terminé — finis-le ou supprime-le`),
        { status: 400 }
      );
    }

    const teams = await getSessionTeams(sessionId);
    const overall = computeOverallStandings(session, stages, matches, teams);
    const rewardByRank: Record<number, number> = {
      1: session.reward_1st ?? 0,
      2: session.reward_2nd ?? 0,
      3: session.reward_3rd ?? 0,
    };

    const awards: FinishTournamentResult['awards'] = [];
    for (const entry of overall) {
      const amount = rewardByRank[entry.rank] ?? 0;
      if (amount <= 0) continue;
      const { rows: members } = await client.query<{ user_id: number }>(
        'SELECT user_id FROM tournament_team_members WHERE team_id = $1 ORDER BY id ASC',
        [entry.team_id]
      );
      for (const member of members) {
        await spService.creditSP({
          userId: member.user_id,
          amount,
          type: 'event_reward',
          seasonId: session.season_id,
          relatedId: sessionId,
          note: session.title ?? 'Événement',
          client,
        });
        awards.push({ userId: member.user_id, amount, rank: entry.rank, teamId: entry.team_id });
      }
    }

    await client.query('UPDATE event_sessions SET tournament_finished_at = NOW() WHERE id = $1', [
      sessionId,
    ]);
    await client.query('COMMIT');
    return { awards };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

export async function createAnnouncement(
  sessionId: number,
  authorId: number,
  body: string
): Promise<TournamentAnnouncementEntry> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);

  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw Object.assign(new Error('L’annonce doit faire entre 1 et 500 caractères'), {
      status: 400,
    });
  }

  const { rows } = await pool.query<TournamentAnnouncementEntry>(
    `INSERT INTO tournament_announcements (session_id, author_id, body)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [sessionId, authorId, trimmed]
  );
  const { rows: author } = await pool.query<{ username: string }>(
    'SELECT username FROM users WHERE id = $1',
    [authorId]
  );
  return { ...rows[0]!, author_username: author[0]?.username ?? '' };
}
