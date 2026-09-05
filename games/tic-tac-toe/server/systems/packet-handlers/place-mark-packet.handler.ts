import { type Registry } from '@nanoforge-dev/ecs-server';
import { type Context } from '@nanoforge-dev/common';
import { type NetworkServerLibrary } from '@nanoforge-dev/network-server';
import { matches, Mark, type MatchRoom } from '../../main.js';
import { sendMatchState } from '../../network-utils.js';

interface PlaceMarkPacket {
  type: 'placeMark';
  index: number;
}

const WIN_LINES: readonly [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkWinner(board: Mark[]): Mark.X | Mark.O | null {
  for (const [a, b, c] of WIN_LINES) {
    const value = board[a];
    if (value === undefined || value === Mark.Empty) continue;
    if (value === board[b] && value === board[c]) {
      return value;
    }
  }
  return null;
}

function findRoom(clientId: number): MatchRoom | undefined {
  for (const room of matches.values()) {
    if (room.players.some((p) => p.clientId === clientId)) return room;
  }
  return undefined;
}

/**
 * Seule route par laquelle le plateau change — le client n'envoie qu'une intention
 * (l'index cliqué), tout le reste (tour, case libre, victoire/égalité) est validé et
 * décidé ici. Une égalité relance une manche dans la même partie plutôt que de
 * "nulle" le défi SP : ce jeu sert à départager une mise, pas à la partager (voir
 * CLAUDE.md, section défis "tic_tac_toe").
 */
export function placeMarkPacketHandler(
  clientId: number,
  packet: PlaceMarkPacket,
  _registry: Registry,
  ctx: Context
): void {
  const network = ctx.libs.getNetwork<NetworkServerLibrary>();
  const room = findRoom(clientId);
  if (!room || room.status !== 'playing') return;

  const player = room.players.find((p) => p.clientId === clientId);
  if (!player || player.symbol !== room.turn) return;

  const index = packet.index;
  if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index] !== Mark.Empty) return;

  room.board[index] = player.symbol;

  const winner = checkWinner(room.board);
  if (winner !== null) {
    room.status = 'won';
    room.winnerMark = winner;
    room.winnerUserId = room.players.find((p) => p.symbol === winner)!.userId;
  } else if (room.board.every((cell) => cell !== Mark.Empty)) {
    room.round += 1;
    room.roundStartMark = room.roundStartMark === Mark.X ? Mark.O : Mark.X;
    room.turn = room.roundStartMark;
    room.board = new Array(9).fill(Mark.Empty);
  } else {
    room.turn = room.turn === Mark.X ? Mark.O : Mark.X;
  }

  sendMatchState(network, room);
}
