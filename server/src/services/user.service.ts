import { pool } from '../db/pool.js';
import type { AdminUserSummary, PrivateUser, PublicUser, UserRow } from '../types.js';

const PUBLIC_FIELDS = `
  id, username, avatar_url, role, sp_balance, sp_total_earned,
  login_streak, created_at, is_leaderboard_hidden
`;

const PRIVATE_FIELDS = `${PUBLIC_FIELDS}, email, last_login_date`;

const ADMIN_LIST_FIELDS = `
  id, username, email, avatar_url, role, sp_balance, sp_total_earned,
  login_streak, created_at, is_leaderboard_hidden, disabled_at
`;

export async function findByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE username = $1', [
    username,
  ]);
  return rows[0] ?? null;
}

export async function findById(id: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function updateAvatar(id: number, avatarUrl: string): Promise<void> {
  await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, id]);
}

export async function setLeaderboardHidden(
  id: number,
  hidden: boolean
): Promise<PrivateUser | null> {
  const { rows } = await pool.query<PrivateUser>(
    `UPDATE users SET is_leaderboard_hidden = $1 WHERE id = $2 RETURNING ${PRIVATE_FIELDS}`,
    [hidden, id]
  );
  return rows[0] ?? null;
}

export async function listAllForAdmin(): Promise<AdminUserSummary[]> {
  const { rows } = await pool.query<AdminUserSummary>(
    `SELECT ${ADMIN_LIST_FIELDS} FROM users ORDER BY username ASC`
  );
  return rows;
}

export async function setDisabled(
  id: number,
  disabled: boolean,
  disabledBy: number | null
): Promise<AdminUserSummary | null> {
  const { rows } = await pool.query<AdminUserSummary>(
    `UPDATE users SET disabled_at = $1, disabled_by = $2 WHERE id = $3
     RETURNING ${ADMIN_LIST_FIELDS}`,
    [disabled ? new Date() : null, disabled ? disabledBy : null, id]
  );
  return rows[0] ?? null;
}

export async function listAllIds(excludeId?: number): Promise<number[]> {
  if (excludeId !== undefined) {
    const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE id != $1', [
      excludeId,
    ]);
    return rows.map((r) => r.id);
  }
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users');
  return rows.map((r) => r.id);
}

export async function getPublicProfile(username: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<PublicUser>(
    `SELECT ${PUBLIC_FIELDS} FROM users WHERE username = $1`,
    [username]
  );
  return rows[0] ?? null;
}

export async function getPrivateProfile(id: number): Promise<PrivateUser | null> {
  const { rows } = await pool.query<PrivateUser>(
    `SELECT ${PRIVATE_FIELDS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

export async function createUser({
  username,
  email,
  passwordHash,
}: CreateUserInput): Promise<PrivateUser> {
  const { rows } = await pool.query<PrivateUser>(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${PRIVATE_FIELDS}`,
    [username, email, passwordHash]
  );
  return rows[0] as PrivateUser;
}
