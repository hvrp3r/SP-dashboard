import { type Registry } from '@nanoforge-dev/ecs-client';
import { Mark } from '../../components/board.component.js';
import { MatchPhase, MatchStatusComponent } from '../../components/match-status.component.js';

interface MatchStatePacket {
  type: 'matchState';
  board: Mark[];
  turn: Mark;
  status: 'waiting' | 'playing' | 'won';
  winnerId: number | null;
  winnerMark: Mark | null;
  round: number;
  myMark: Mark;
}

const PHASE_BY_STATUS: Record<MatchStatePacket['status'], MatchPhase> = {
  waiting: MatchPhase.WaitingOpponent,
  playing: MatchPhase.Playing,
  won: MatchPhase.Won,
};

export function matchStatePacketHandler(packet: MatchStatePacket, registry: Registry): void {
  const entities: { MatchStatusComponent: MatchStatusComponent }[] = registry.getZipper([
    MatchStatusComponent,
  ]);
  const match = entities[0]?.MatchStatusComponent;
  if (!match) return;

  // Une nouvelle manche (après une égalité) doit pouvoir redéclencher l'affichage
  // des marqueurs depuis zéro — board-render.system.ts s'en sert pour savoir quand
  // vider le plateau visuel plutôt que de continuer à empiler des marqueurs.
  match.board = packet.board;
  match.turn = packet.turn;
  match.phase = PHASE_BY_STATUS[packet.status];
  match.winnerUserId = packet.winnerId;
  match.winnerMark = packet.winnerMark;
  match.round = packet.round;
  match.myMark = packet.myMark;
  match.error = null;
}
