import { pool } from '../db/pool.js';
import type { AuthenticatedUser, EventSessionRow, UserPermission } from '../types.js';

// Toujours relu en BDD (pas porté par le JWT) : une révocation par le MSP
// prend effet immédiatement, sans attendre l'expiration de l'access token.
export async function hasPermission(userId: number, permission: UserPermission): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM user_permissions WHERE user_id = $1 AND permission = $2',
    [userId, permission]
  );
  return rows.length > 0;
}

/** Retourne true si la permission vient d'être accordée (false si déjà présente). */
export async function grantPermission(
  userId: number,
  permission: UserPermission,
  grantedBy: number
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO user_permissions (user_id, permission, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, permission) DO NOTHING`,
    [userId, permission, grantedBy]
  );
  return (rowCount ?? 0) > 0;
}

export async function revokePermission(userId: number, permission: UserPermission): Promise<void> {
  await pool.query('DELETE FROM user_permissions WHERE user_id = $1 AND permission = $2', [
    userId,
    permission,
  ]);
}

export async function canCreateEvents(user: AuthenticatedUser): Promise<boolean> {
  return user.role === 'admin' || hasPermission(user.id, 'event_organizer');
}

/**
 * Le MSP gère toutes les sessions ; un organisateur uniquement celles qu'il a
 * créées, et seulement tant qu'il a encore la permission.
 */
export async function canManageSession(
  user: AuthenticatedUser,
  session: Pick<EventSessionRow, 'created_by'>
): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (session.created_by !== user.id) return false;
  return hasPermission(user.id, 'event_organizer');
}
