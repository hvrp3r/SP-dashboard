import type { NetworkServerLibrary } from '@nanoforge-dev/network-server';
import type { MatchRoom } from './main.js';

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** Diffuse l'état autoritatif à chaque joueur connu de la partie — `myMark` diffère par destinataire. */
export function sendMatchState(network: NetworkServerLibrary, room: MatchRoom): void {
  for (const player of room.players) {
    network.tcp.sendToClient(
      player.clientId,
      encode({
        type: 'matchState',
        board: room.board,
        turn: room.turn,
        status: room.status,
        winnerId: room.winnerUserId,
        winnerMark: room.winnerMark,
        round: room.round,
        myMark: player.symbol,
      })
    );
  }
}

export function sendError(network: NetworkServerLibrary, clientId: number, message: string): void {
  network.tcp.sendToClient(clientId, encode({ type: 'error', message }));
}
