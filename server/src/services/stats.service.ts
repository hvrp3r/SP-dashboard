import { pool } from '../db/pool.js';
import type { SpTransactionType } from '../types.js';

export interface PlayerStats {
  rank: number | null;
  challenges: { wins: number; losses: number };
  transactionTotals: Partial<Record<SpTransactionType, { total: number; count: number }>>;
}

export async function getPlayerStats(userId: number): Promise<PlayerStats> {
  const { rows: userRows } = await pool.query<{
    sp_balance: number;
    is_leaderboard_hidden: boolean;
  }>('SELECT sp_balance, is_leaderboard_hidden FROM users WHERE id = $1', [userId]);
  const user = userRows[0];

  const [rankResult, challengeResult, transactionRows] = await Promise.all([
    user && !user.is_leaderboard_hidden
      ? pool.query<{ rank: string }>(
          `SELECT COUNT(*) + 1 AS rank FROM users u2
           WHERE u2.sp_balance > $1 AND u2.is_leaderboard_hidden = false`,
          [user.sp_balance]
        )
      : Promise.resolve(null),
    pool.query<{ wins: string; losses: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE c.winner_id = $1) AS wins,
         COUNT(*) FILTER (WHERE c.winner_id != $1) AS losses
       FROM challenges c
       JOIN challenge_participants p
         ON p.challenge_id = c.id AND p.user_id = $1 AND p.status = 'accepted'
       WHERE c.status = 'resolved'`,
      [userId]
    ),
    pool.query<{ type: SpTransactionType; total: string; count: string }>(
      `SELECT type, SUM(amount) AS total, COUNT(*) AS count
       FROM sp_transactions
       WHERE user_id = $1
       GROUP BY type`,
      [userId]
    ),
  ]);

  const transactionTotals: PlayerStats['transactionTotals'] = {};
  for (const row of transactionRows.rows) {
    transactionTotals[row.type] = { total: Number(row.total), count: Number(row.count) };
  }

  return {
    rank: rankResult ? Number(rankResult.rows[0]?.rank ?? 1) : null,
    challenges: {
      wins: Number(challengeResult.rows[0]?.wins ?? 0),
      losses: Number(challengeResult.rows[0]?.losses ?? 0),
    },
    transactionTotals,
  };
}
