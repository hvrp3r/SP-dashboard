import type { Request, Response } from 'express';
import * as chatService from '../services/chat.service.js';
import * as minigameService from '../services/minigame.service.js';
import type { ChatRoom } from '../types.js';

const VALID_ROOMS: ChatRoom[] = ['global', 'crates', 'blackjack', 'crash', 'tower', 'minigame'];
const MAX_MESSAGE_LENGTH = 500;

/** roomKey n'a de sens que pour la room 'minigame' (id de la session) — les autres
 * salons (global + jeux casino singleton) sont partagés par tous les joueurs, même
 * logique que parseSpectatorRoom dans gambling.controller.ts. */
async function parseRoom(
  roomRaw: unknown,
  roomKeyRaw: unknown
): Promise<{ room: ChatRoom; roomKey: string } | null> {
  if (typeof roomRaw !== 'string' || !VALID_ROOMS.includes(roomRaw as ChatRoom)) return null;
  const room = roomRaw as ChatRoom;
  if (room !== 'minigame') return { room, roomKey: '' };

  const roomKey = typeof roomKeyRaw === 'string' ? roomKeyRaw.slice(0, 50) : '';
  if (!roomKey || !/^\d+$/.test(roomKey)) return null;
  const session = await minigameService.getSessionById(Number(roomKey));
  if (!session) return null;
  return { room, roomKey };
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const parsed = await parseRoom(req.query.room, req.query.roomKey);
  if (!parsed) {
    res.status(400).json({ error: 'Salon de discussion invalide' });
    return;
  }

  const afterIdRaw = Number(req.query.afterId);
  const afterId = Number.isInteger(afterIdRaw) && afterIdRaw > 0 ? afterIdRaw : null;
  const beforeIdRaw = Number(req.query.beforeId);
  const beforeId = Number.isInteger(beforeIdRaw) && beforeIdRaw > 0 ? beforeIdRaw : null;

  let messages;
  if (afterId) {
    messages = await chatService.listMessagesAfter(parsed.room, parsed.roomKey, afterId);
  } else if (beforeId) {
    messages = await chatService.listMessagesBefore(parsed.room, parsed.roomKey, beforeId);
  } else {
    messages = await chatService.listMessages(parsed.room, parsed.roomKey);
  }
  res.json(messages);
}

export async function postMessage(req: Request, res: Response): Promise<void> {
  const parsed = await parseRoom(req.body?.room, req.body?.roomKey);
  if (!parsed) {
    res.status(400).json({ error: 'Salon de discussion invalide' });
    return;
  }

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) {
    res.status(400).json({ error: 'Le message est requis' });
    return;
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Le message ne peut pas dépasser ${MAX_MESSAGE_LENGTH} caractères` });
    return;
  }

  const message = await chatService.postMessage(parsed.room, parsed.roomKey, req.user!.id, body);
  res.status(201).json(message);
}
