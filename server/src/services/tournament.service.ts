import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import type { QueryResult } from 'pg';
import type {
  EventSessionRow,
  TournamentAnnouncementEntry,
  TournamentMatchFeed,
  TournamentMatchRow,
  TournamentMatchView,
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
     ORDER BY CASE bracket WHEN 'main' THEN 0 WHEN 'winners' THEN 1 WHEN 'losers' THEN 2
                WHEN 'grand_final' THEN 3 ELSE 4 END, round ASC, position ASC`,
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
      new Error('L’arbre a déjà été généré — réinitialise-le d’abord pour modifier les équipes'),
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

export async function generateBracket(sessionId: number): Promise<TournamentMatchRow[]> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);
  const format = session.tournament_format ?? 'single_elim';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertNoMatches(client, sessionId);

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

    const seeded = [...teams].sort((a, b) => a.id - b.id); // ordre de création = seed

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
           (session_id, bracket, round, position, feed_a, feed_b, team_a_id, team_b_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          sessionId,
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
      'SELECT * FROM tournament_matches WHERE session_id = $1 ORDER BY id ASC',
      [sessionId]
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
    return inserted;
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
// Reset de l'arbre (aucun match résolu uniquement)
// ---------------------------------------------------------------------------

export async function resetBracket(sessionId: number): Promise<void> {
  await getTournamentSession(sessionId);

  const client = await pool.connect();
  try {
    const { rowCount: resolved } = await client.query(
      'SELECT 1 FROM tournament_matches WHERE session_id = $1 AND winner_team_id IS NOT NULL LIMIT 1',
      [sessionId]
    );
    if ((resolved ?? 0) > 0) {
      throw Object.assign(
        new Error('Impossible de réinitialiser : au moins un match a déjà été joué'),
        { status: 400 }
      );
    }
    await client.query('DELETE FROM tournament_matches WHERE session_id = $1', [sessionId]);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Résolution d'un match + propagation + dotation
// ---------------------------------------------------------------------------

export interface ResolveMatchResult {
  finished: boolean;
  championTeamId: number | null;
  awards: Array<{ userId: number; amount: number; rank: number; teamId: number }>;
}

export async function resolveMatch(
  sessionId: number,
  matchId: number,
  winnerTeamId: number
): Promise<ResolveMatchResult> {
  const session = await getTournamentSession(sessionId);
  assertOpen(session);
  const format = session.tournament_format ?? 'single_elim';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: allRows } = await client.query<LiveMatch>(
      'SELECT * FROM tournament_matches WHERE session_id = $1 ORDER BY id ASC FOR UPDATE',
      [sessionId]
    );
    const initial = new Map(allRows.map((m) => [m.id, { ...m }]));
    const byId = new Map(allRows.map((m) => [m.id, m]));
    const match = byId.get(matchId);
    if (!match) {
      throw Object.assign(new Error('Match introuvable'), { status: 404 });
    }
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
             (session_id, bracket, round, position, feed_a, feed_b, team_a_id, team_b_id)
           VALUES ($1, 'grand_final_reset', 1, 1, $2, $3, $4, $5)
           RETURNING *`,
          [
            sessionId,
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

    // Détection de fin + distribution de la dotation (même transaction)
    const finished = isTournamentFinished(format, byId);
    const awards: ResolveMatchResult['awards'] = [];
    let championTeamId: number | null = null;

    if (finished) {
      const placements = computePlacements(format, byId);
      championTeamId = placements.champion;
      const teams = await getSessionTeams(sessionId);
      const teamById = new Map(teams.map((t) => [t.id, t]));

      const rewardPlan: Array<{ rank: number; amount: number; teamIds: number[] }> = [
        {
          rank: 1,
          amount: session.reward_1st ?? 0,
          teamIds: placements.champion != null ? [placements.champion] : [],
        },
        {
          rank: 2,
          amount: session.reward_2nd ?? 0,
          teamIds: placements.runnerUp != null ? [placements.runnerUp] : [],
        },
        { rank: 3, amount: session.reward_3rd ?? 0, teamIds: placements.thirds },
      ];
      for (const { rank, amount, teamIds } of rewardPlan) {
        if (!amount || amount <= 0) continue;
        for (const teamId of teamIds) {
          if (!teamById.has(teamId)) continue;
          const { rows: members } = await client.query<{ user_id: number }>(
            'SELECT user_id FROM tournament_team_members WHERE team_id = $1 ORDER BY id ASC',
            [teamId]
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
            awards.push({ userId: member.user_id, amount, rank, teamId });
          }
        }
      }
    }

    await client.query('COMMIT');
    return { finished, championTeamId, awards };
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

function computePlacements(
  format: string,
  byId: Map<number, LiveMatch>
): { champion: number | null; runnerUp: number | null; thirds: number[] } {
  const all = [...byId.values()];
  if (format === 'round_robin') {
    const standings = computeRoundRobinStandings(byId);
    return {
      champion: standings[0]?.team_id ?? null,
      runnerUp: standings[1]?.team_id ?? null,
      thirds: standings[2] ? [standings[2].team_id] : [],
    };
  }
  if (format === 'double_elim') {
    const last =
      all.find((m) => m.bracket === 'grand_final_reset') ??
      all.find((m) => m.bracket === 'grand_final');
    if (!last || !last.winner_team_id) {
      return { champion: null, runnerUp: null, thirds: [] };
    }
    // 3e = perdant de la finale losers (s'il existe — pas à 2 équipes)
    const lbRounds = all.filter((m) => m.bracket === 'losers').map((m) => m.round);
    const thirds: number[] = [];
    if (lbRounds.length > 0) {
      const lbFinal = all.find(
        (m) => m.bracket === 'losers' && m.round === Math.max(...lbRounds)
      );
      if (lbFinal && lbFinal.winner_team_id) {
        const lbLoser = matchLoser(lbFinal);
        if (lbLoser != null) thirds.push(lbLoser);
      }
    }
    return { champion: last.winner_team_id, runnerUp: matchLoser(last), thirds };
  }
  // single elim : champion + finaliste + les deux perdants des demi-finales
  const main = all.filter((m) => m.bracket === 'main');
  const maxRound = Math.max(...main.map((m) => m.round));
  const final = main.find((m) => m.round === maxRound);
  if (!final || !final.winner_team_id) {
    return { champion: null, runnerUp: null, thirds: [] };
  }
  const thirds: number[] = [];
  if (maxRound >= 2) {
    for (const semi of main.filter((m) => m.round === maxRound - 1)) {
      const semiLoser = matchLoser(semi);
      if (semiLoser != null) thirds.push(semiLoser);
    }
  }
  return { champion: final.winner_team_id, runnerUp: matchLoser(final), thirds };
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

/** État global du tournoi pour la vue détail : arbre généré ? terminé ?
 * champion ? classement (round-robin uniquement). */
export async function getTournamentState(sessionId: number): Promise<{
  bracketGenerated: boolean;
  finished: boolean;
  championTeamId: number | null;
  standings: TournamentStandingsEntry[];
}> {
  const [matches, teams] = await Promise.all([
    getSessionMatches(sessionId),
    getSessionTeams(sessionId),
  ]);
  const bracketGenerated = matches.length > 0;
  if (!bracketGenerated) {
    return { bracketGenerated, finished: false, championTeamId: null, standings: [] };
  }
  const session = await getTournamentSession(sessionId);
  const format = session.tournament_format ?? 'single_elim';
  const byId = new Map(matches.map((m) => [m.id, m]));
  const finished = isTournamentFinished(format, byId);
  if (format === 'round_robin') {
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const standings = computeRoundRobinStandings(byId).map((s) => {
      const team = teamById.get(s.team_id);
      return { ...s, tag: team?.tag ?? '', logo_url: team?.logo_url ?? null };
    });
    return { bracketGenerated, finished, championTeamId: standings[0]?.team_id ?? null, standings };
  }
  const championTeamId = finished ? computePlacements(format, byId).champion : null;
  return { bracketGenerated, finished, championTeamId, standings: [] };
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
