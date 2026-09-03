import { pool } from '../db/pool.js';
import type { NotificationRow, NotificationType } from '../types.js';

interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  message: string;
  link?: string | null;
}

export async function createNotification({
  userId,
  type,
  message,
  link = null,
}: CreateNotificationInput): Promise<NotificationRow> {
  const { rows } = await pool.query<NotificationRow>(
    `INSERT INTO notifications (user_id, type, message, link)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, type, message, link]
  );
  return rows[0] as NotificationRow;
}

export async function createNotificationsForUsers(
  userIds: number[],
  type: NotificationType,
  message: string,
  link: string | null = null
): Promise<void> {
  if (userIds.length === 0) return;
  await pool.query(
    `INSERT INTO notifications (user_id, type, message, link)
     SELECT unnest($1::int[]), $2, $3, $4`,
    [userIds, type, message, link]
  );
}

interface ListOptions {
  limit: number;
  unreadOnly?: boolean;
}

export async function listNotifications(
  userId: number,
  { limit, unreadOnly = false }: ListOptions
): Promise<NotificationRow[]> {
  const unreadClause = unreadOnly ? 'AND read_at IS NULL' : '';
  const { rows } = await pool.query<NotificationRow>(
    `SELECT * FROM notifications
     WHERE user_id = $1 ${unreadClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function countUnread(userId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markRead(id: number, userId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function markAllRead(userId: number): Promise<void> {
  await pool.query(
    'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
}
