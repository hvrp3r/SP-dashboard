import { pool } from '../db/pool.js';
import * as cosmeticsService from './cosmetics.service.js';
import type {
  EquippedCosmetic,
  SuggestionCommentEntry,
  SuggestionCommentRow,
  SuggestionListEntry,
  SuggestionRow,
  SuggestionSort,
  SuggestionStatus,
  SuggestionType,
  SuggestionVoteValue,
} from '../types.js';

/** Fusionne les cosmétiques équipés de l'auteur sur des lignes portant author_id (nullable). */
async function withAuthorCosmetics<T extends { author_id: number | null }>(
  rows: T[]
): Promise<(T & { author_equipped_cosmetics: EquippedCosmetic[] })[]> {
  const authorIds = [...new Set(rows.map((r) => r.author_id).filter((id): id is number => id !== null))];
  const equippedByUser = await cosmeticsService.getEquippedForUsers(authorIds);
  return rows.map((row) => ({
    ...row,
    author_equipped_cosmetics: row.author_id ? equippedByUser.get(row.author_id) ?? [] : [],
  }));
}

const LIST_FROM = `
  FROM suggestions s
  LEFT JOIN users u ON u.id = s.author_id
`;

// Sous-requêtes scalaires plutôt que des LEFT JOIN + GROUP BY : évite le produit
// cartésien votes×commentaires qui fausserait les agrégats sur une même ligne.
const LIST_COLUMNS = `
  s.*,
  u.username AS author_username,
  u.avatar_url AS author_avatar_url,
  COALESCE(
    (SELECT SUM(v.value) FROM suggestion_votes v WHERE v.suggestion_id = s.id), 0
  )::int AS vote_count,
  (SELECT COUNT(*) FROM suggestion_comments c WHERE c.suggestion_id = s.id)::int AS comment_count,
  COALESCE(
    (SELECT v2.value FROM suggestion_votes v2 WHERE v2.suggestion_id = s.id AND v2.user_id = $1),
    0
  ) AS user_vote
`;

interface CreateSuggestionInput {
  authorId: number;
  type: SuggestionType;
  title: string;
  description: string | null;
}

export async function createSuggestion({
  authorId,
  type,
  title,
  description,
}: CreateSuggestionInput): Promise<SuggestionRow> {
  const { rows } = await pool.query<SuggestionRow>(
    `INSERT INTO suggestions (author_id, type, title, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [authorId, type, title, description]
  );
  return rows[0] as SuggestionRow;
}

interface ListOptions {
  viewerId: number;
  status?: SuggestionStatus;
  sort: SuggestionSort;
}

export async function listSuggestions({
  viewerId,
  status,
  sort,
}: ListOptions): Promise<SuggestionListEntry[]> {
  const orderClause = sort === 'top' ? 'vote_count DESC, s.created_at DESC' : 's.created_at DESC';
  const whereClause = status ? 'WHERE s.status = $2' : '';
  const params = status ? [viewerId, status] : [viewerId];
  const { rows } = await pool.query<Omit<SuggestionListEntry, 'author_equipped_cosmetics'>>(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM} ${whereClause} ORDER BY ${orderClause}`,
    params
  );
  return withAuthorCosmetics(rows);
}

export async function getSuggestionById(id: number): Promise<SuggestionRow | null> {
  const { rows } = await pool.query<SuggestionRow>('SELECT * FROM suggestions WHERE id = $1', [
    id,
  ]);
  return rows[0] ?? null;
}

export async function getSuggestionEntry(
  id: number,
  viewerId: number
): Promise<SuggestionListEntry | null> {
  const { rows } = await pool.query<Omit<SuggestionListEntry, 'author_equipped_cosmetics'>>(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE s.id = $2`,
    [viewerId, id]
  );
  if (!rows[0]) return null;
  const [entry] = await withAuthorCosmetics(rows);
  return entry as SuggestionListEntry;
}

export async function listComments(suggestionId: number): Promise<SuggestionCommentEntry[]> {
  const { rows } = await pool.query<Omit<SuggestionCommentEntry, 'author_equipped_cosmetics'>>(
    `SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar_url
     FROM suggestion_comments c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.suggestion_id = $1
     ORDER BY c.created_at ASC`,
    [suggestionId]
  );
  return withAuthorCosmetics(rows);
}

export async function addComment(
  suggestionId: number,
  authorId: number,
  body: string
): Promise<SuggestionCommentRow> {
  const { rows } = await pool.query<SuggestionCommentRow>(
    `INSERT INTO suggestion_comments (suggestion_id, author_id, body)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [suggestionId, authorId, body]
  );
  return rows[0] as SuggestionCommentRow;
}

/**
 * Vote up/down façon Reddit. Revoter dans la même direction retire le vote
 * (bascule) ; voter dans l'autre direction le remplace. Renvoie le nouvel état.
 */
export async function castVote(
  suggestionId: number,
  userId: number,
  value: SuggestionVoteValue
): Promise<{ userVote: SuggestionVoteValue | 0; voteCount: number }> {
  const { rows: existingRows } = await pool.query<{ value: number }>(
    'SELECT value FROM suggestion_votes WHERE suggestion_id = $1 AND user_id = $2',
    [suggestionId, userId]
  );
  const existing = existingRows[0]?.value ?? null;

  let userVote: SuggestionVoteValue | 0;
  if (existing === value) {
    await pool.query('DELETE FROM suggestion_votes WHERE suggestion_id = $1 AND user_id = $2', [
      suggestionId,
      userId,
    ]);
    userVote = 0;
  } else {
    await pool.query(
      `INSERT INTO suggestion_votes (suggestion_id, user_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (suggestion_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
      [suggestionId, userId, value]
    );
    userVote = value;
  }

  const { rows } = await pool.query<{ sum: string | null }>(
    'SELECT SUM(value) FROM suggestion_votes WHERE suggestion_id = $1',
    [suggestionId]
  );
  return { userVote, voteCount: Number(rows[0]?.sum ?? 0) };
}

export async function closeSuggestion(
  id: number,
  closedBy: number
): Promise<SuggestionRow | null> {
  const { rows } = await pool.query<SuggestionRow>(
    `UPDATE suggestions SET status = 'closed', closed_at = NOW(), closed_by = $2
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [id, closedBy]
  );
  return rows[0] ?? null;
}

export async function deleteSuggestion(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM suggestions WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
