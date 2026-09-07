import { pool } from '../db/pool.js';
import * as cosmeticsService from './cosmetics.service.js';
import type { ChatMessageEntry, ChatRoom } from '../types.js';

const HISTORY_LIMIT = 50;
const POLL_LIMIT = 200;

async function withCosmetics(
  rows: Omit<ChatMessageEntry, 'equipped_cosmetics'>[]
): Promise<ChatMessageEntry[]> {
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}

/** Historique initial d'un salon — les `HISTORY_LIMIT` derniers messages, remis en ordre chronologique. */
export async function listMessages(room: ChatRoom, roomKey: string): Promise<ChatMessageEntry[]> {
  const { rows } = await pool.query<Omit<ChatMessageEntry, 'equipped_cosmetics'>>(
    `SELECT m.id, m.room, m.room_key, m.user_id, m.body, m.created_at, u.username, u.avatar_url
     FROM chat_messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.room = $1 AND m.room_key = $2
     ORDER BY m.id DESC
     LIMIT $3`,
    [room, roomKey, HISTORY_LIMIT]
  );
  rows.reverse();
  return withCosmetics(rows);
}

/** Pagination arrière ("charger les messages précédents") : les `HISTORY_LIMIT`
 * messages antérieurs à `beforeId`, remis en ordre chronologique. Le contrôleur
 * déduit qu'il n'y a plus d'historique plus ancien quand ce nombre est renvoyé
 * incomplet (< HISTORY_LIMIT), sans requête de comptage séparée. */
export async function listMessagesBefore(
  room: ChatRoom,
  roomKey: string,
  beforeId: number
): Promise<ChatMessageEntry[]> {
  const { rows } = await pool.query<Omit<ChatMessageEntry, 'equipped_cosmetics'>>(
    `SELECT m.id, m.room, m.room_key, m.user_id, m.body, m.created_at, u.username, u.avatar_url
     FROM chat_messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.room = $1 AND m.room_key = $2 AND m.id < $3
     ORDER BY m.id DESC
     LIMIT $4`,
    [room, roomKey, beforeId, HISTORY_LIMIT]
  );
  rows.reverse();
  return withCosmetics(rows);
}

/** Sondage incrémental : uniquement les messages postérieurs à `afterId`, en ordre chronologique. */
export async function listMessagesAfter(
  room: ChatRoom,
  roomKey: string,
  afterId: number
): Promise<ChatMessageEntry[]> {
  const { rows } = await pool.query<Omit<ChatMessageEntry, 'equipped_cosmetics'>>(
    `SELECT m.id, m.room, m.room_key, m.user_id, m.body, m.created_at, u.username, u.avatar_url
     FROM chat_messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.room = $1 AND m.room_key = $2 AND m.id > $3
     ORDER BY m.id ASC
     LIMIT $4`,
    [room, roomKey, afterId, POLL_LIMIT]
  );
  return withCosmetics(rows);
}

export async function postMessage(
  room: ChatRoom,
  roomKey: string,
  userId: number,
  body: string
): Promise<ChatMessageEntry> {
  const { rows } = await pool.query<Omit<ChatMessageEntry, 'equipped_cosmetics'>>(
    `INSERT INTO chat_messages (room, room_key, user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, room, room_key, user_id, body, created_at,
       (SELECT username FROM users WHERE id = $3) AS username,
       (SELECT avatar_url FROM users WHERE id = $3) AS avatar_url`,
    [room, roomKey, userId, body]
  );
  const row = rows[0]!;
  const equipped = await cosmeticsService.getEquipped(userId);
  return { ...row, equipped_cosmetics: equipped };
}
