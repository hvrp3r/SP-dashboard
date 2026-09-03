import { pool } from '../db/pool.js';
import type { LeaderboardEntry, LeaderboardSort } from '../types.js';

const SORT_COLUMNS: Record<LeaderboardSort, string> = {
  sp_balance: 'sp_balance',
  sp_total_earned: 'sp_total_earned',
};

export async function getLeaderboard(sort: LeaderboardSort): Promise<LeaderboardEntry[]> {
  const column = SORT_COLUMNS[sort];
  const { rows } = await pool.query<LeaderboardEntry>(
    `SELECT id, username, avatar_url, role, sp_balance, sp_total_earned, login_streak
     FROM users
     WHERE is_leaderboard_hidden = false
     ORDER BY ${column} DESC, sp_total_earned DESC, username ASC`
  );
  return rows;
}
