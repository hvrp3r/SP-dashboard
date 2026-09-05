import { pool } from '../db/pool.js';
import * as cosmeticsService from './cosmetics.service.js';
import type { SeasonRow, SeasonSnapshotEntry, SeasonStatus } from '../types.js';

export async function getActiveSeason(): Promise<SeasonRow | null> {
  const { rows } = await pool.query<SeasonRow>(`SELECT * FROM seasons WHERE status = 'active' LIMIT 1`);
  return rows[0] ?? null;
}

export async function listSeasons(status?: SeasonStatus): Promise<SeasonRow[]> {
  if (status) {
    const { rows } = await pool.query<SeasonRow>(
      'SELECT * FROM seasons WHERE status = $1 ORDER BY starts_at DESC',
      [status]
    );
    return rows;
  }
  const { rows } = await pool.query<SeasonRow>('SELECT * FROM seasons ORDER BY starts_at DESC');
  return rows;
}

export async function getSeasonById(id: number): Promise<SeasonRow | null> {
  const { rows } = await pool.query<SeasonRow>('SELECT * FROM seasons WHERE id = $1', [id]);
  return rows[0] ?? null;
}

interface CreateSeasonInput {
  name: string;
  startsAt?: string;
  createdBy: number;
}

export async function createSeason({
  name,
  startsAt,
  createdBy,
}: CreateSeasonInput): Promise<SeasonRow> {
  const { rows } = await pool.query<SeasonRow>(
    `INSERT INTO seasons (name, starts_at, status, created_by)
     VALUES ($1, COALESCE($2, NOW()), 'active', $3)
     RETURNING *`,
    [name, startsAt ?? null, createdBy]
  );
  return rows[0] as SeasonRow;
}

export async function closeSeason(seasonId: number): Promise<SeasonRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO season_snapshots (season_id, user_id, final_balance, final_total_earned, rank)
       SELECT $1, id, sp_balance, sp_total_earned,
              RANK() OVER (ORDER BY sp_balance DESC, sp_total_earned DESC)
       FROM users
       WHERE is_leaderboard_hidden = false AND disabled_at IS NULL`,
      [seasonId]
    );

    const { rows } = await client.query<SeasonRow>(
      `UPDATE seasons SET status = 'closed', ends_at = NOW() WHERE id = $1 RETURNING *`,
      [seasonId]
    );

    await client.query('UPDATE users SET sp_balance = 0, sp_total_earned = 0');

    await client.query('COMMIT');
    return rows[0] as SeasonRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSeasonSnapshot(seasonId: number): Promise<SeasonSnapshotEntry[]> {
  const { rows } = await pool.query<Omit<SeasonSnapshotEntry, 'equipped_cosmetics'>>(
    `SELECT s.id, s.season_id, s.user_id, s.final_balance, s.final_total_earned, s.rank, s.created_at,
            u.username, u.avatar_url
     FROM season_snapshots s
     JOIN users u ON u.id = s.user_id
     WHERE s.season_id = $1
     ORDER BY s.rank ASC`,
    [seasonId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}
