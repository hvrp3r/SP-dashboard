import { pool } from '../db/pool.js';
import type { AdminConfigRow } from '../types.js';

export async function getConfigValue(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM admin_config WHERE key = $1',
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function listConfig(): Promise<AdminConfigRow[]> {
  const { rows } = await pool.query<AdminConfigRow>('SELECT * FROM admin_config ORDER BY key ASC');
  return rows;
}

export async function setConfigValue(
  key: string,
  value: string,
  updatedBy: number
): Promise<AdminConfigRow | null> {
  const { rows } = await pool.query<AdminConfigRow>(
    `UPDATE admin_config SET value = $1, updated_by = $2, updated_at = NOW()
     WHERE key = $3
     RETURNING *`,
    [value, updatedBy, key]
  );
  return rows[0] ?? null;
}
