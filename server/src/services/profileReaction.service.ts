import { pool } from '../db/pool.js';
import type { ProfileReactionSummary, ProfileReactionValue } from '../types.js';

export async function getSummary(
  targetUserId: number,
  viewerId: number | null
): Promise<ProfileReactionSummary> {
  const { rows } = await pool.query<{
    like_count: number;
    dislike_count: number;
    user_reaction: number | null;
  }>(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM profile_reactions WHERE target_user_id = $1 AND value = 1), 0)::int AS like_count,
       COALESCE((SELECT COUNT(*) FROM profile_reactions WHERE target_user_id = $1 AND value = -1), 0)::int AS dislike_count,
       (SELECT value FROM profile_reactions WHERE target_user_id = $1 AND voter_id = $2) AS user_reaction`,
    [targetUserId, viewerId]
  );
  const row = rows[0];
  return {
    likeCount: row?.like_count ?? 0,
    dislikeCount: row?.dislike_count ?? 0,
    userReaction: (row?.user_reaction ?? 0) as ProfileReactionValue | 0,
  };
}

/**
 * Like/dislike façon vote de suggestion. Revoter dans le même sens retire la
 * réaction (bascule) ; réagir dans l'autre sens la remplace.
 */
export async function castReaction(
  targetUserId: number,
  voterId: number,
  value: ProfileReactionValue
): Promise<ProfileReactionSummary> {
  const { rows: existingRows } = await pool.query<{ value: number }>(
    'SELECT value FROM profile_reactions WHERE target_user_id = $1 AND voter_id = $2',
    [targetUserId, voterId]
  );
  const existing = existingRows[0]?.value ?? null;

  if (existing === value) {
    await pool.query(
      'DELETE FROM profile_reactions WHERE target_user_id = $1 AND voter_id = $2',
      [targetUserId, voterId]
    );
  } else {
    await pool.query(
      `INSERT INTO profile_reactions (target_user_id, voter_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (target_user_id, voter_id) DO UPDATE SET value = EXCLUDED.value`,
      [targetUserId, voterId, value]
    );
  }

  return getSummary(targetUserId, voterId);
}
