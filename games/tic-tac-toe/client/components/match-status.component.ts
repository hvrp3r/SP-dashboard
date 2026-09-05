import { Mark } from './board.component.js';

export enum MatchPhase {
  Connecting,
  WaitingOpponent,
  Playing,
  Won,
}

/**
 * Miroir côté client de l'état autoritatif du serveur (voir server/main.ts#MatchRoom)
 * — un seul de ces composants existe, spawné par main.ts au chargement. Tous les
 * champs sont écrasés par match-state-packet.handler.ts à chaque `matchState` reçu ;
 * rien ici n'est jamais déduit localement (pas de logique de victoire côté client).
 */
export class MatchStatusComponent {
  name = this.constructor.name;
  phase: MatchPhase = MatchPhase.Connecting;
  board: Mark[] = new Array(9).fill(Mark.Empty);
  turn: Mark = Mark.X;
  myMark: Mark | null = null;
  winnerUserId: number | null = null;
  /** Même info que `winnerUserId` mais en symbole (X/O) — le client ne connaît pas
   * son propre id SP (seul son symbole), donc c'est ce qui permet d'afficher
   * "Tu as gagné"/"Tu as perdu" sans dupliquer l'identité utilisateur ici. */
  winnerMark: Mark | null = null;
  round = 1;
  error: string | null = null;
  /** Empêche de reposter `tictactoe:gameover` au parent plusieurs fois pour la même victoire. */
  reportedGameOver = false;
}

// * Required to generate code
export default MatchStatusComponent.name;
