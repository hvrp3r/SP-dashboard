import jwt from 'jsonwebtoken';
import { type Registry } from '@nanoforge-dev/ecs-server';
import { type Context } from '@nanoforge-dev/common';
import { type NetworkServerLibrary } from '@nanoforge-dev/network-server';
import { matches, Mark, type MatchRoom } from '../../main.js';
import { sendError, sendMatchState } from '../../network-utils.js';

interface MatchTokenPayload {
  challengeId: number;
  userId: number;
  username: string;
}

interface JoinMatchPacket {
  type: 'joinMatch';
  token: string;
}

/**
 * Seul point d'entrée dans une partie : le token est émis par l'API Points Sourires
 * (POST /:id/tic-tac-toe/token, requireAuth + participant accepté) et vérifié ICI
 * avec le même JWT_SECRET — ce serveur n'a pas d'autre moyen de savoir qui est qui,
 * donc sans vérification un client pourrait usurper l'identité d'un des deux joueurs
 * ou remplir les deux sièges lui-même pour forcer une victoire.
 */
export function joinMatchPacketHandler(
  clientId: number,
  packet: JoinMatchPacket,
  _registry: Registry,
  ctx: Context
): void {
  const network = ctx.libs.getNetwork<NetworkServerLibrary>();

  let payload: MatchTokenPayload;
  try {
    payload = jwt.verify(packet.token, process.env.JWT_SECRET as string) as unknown as MatchTokenPayload;
  } catch {
    sendError(network, clientId, 'Session invalide ou expirée — relance la partie depuis Points Sourires.');
    return;
  }

  let room = matches.get(payload.challengeId);
  if (!room) {
    room = {
      challengeId: payload.challengeId,
      players: [],
      board: new Array(9).fill(Mark.Empty),
      turn: Mark.X,
      roundStartMark: Mark.X,
      round: 1,
      status: 'waiting',
      winnerUserId: null,
      winnerMark: null,
    } satisfies MatchRoom;
    matches.set(payload.challengeId, room);
  }

  const existing = room.players.find((p) => p.userId === payload.userId);
  if (existing) {
    // Reconnexion (ex: rechargement de l'iframe) — même siège, nouveau clientId.
    existing.clientId = clientId;
  } else {
    if (room.players.length >= 2) {
      sendError(network, clientId, 'Cette partie a déjà ses deux joueurs.');
      return;
    }
    room.players.push({
      userId: payload.userId,
      username: payload.username,
      clientId,
      symbol: room.players.length === 0 ? Mark.X : Mark.O,
    });
  }

  if (room.players.length === 2 && room.status === 'waiting') {
    room.status = 'playing';
  }

  sendMatchState(network, room);
}
