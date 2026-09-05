import { type Registry } from '@nanoforge-dev/ecs-client';
import { Context } from '@nanoforge-dev/common';
import { NetworkClientLibrary } from '@nanoforge-dev/network-client';
import { Cell, Mark } from '../components/board.component.js';
import { MatchPhase, MatchStatusComponent } from '../components/match-status.component.js';

/**
 * Traduit un clic de case en intention `placeMark` — ne valide rien localement
 * (tour du joueur, case déjà prise…) au-delà de ce qui évite un envoi inutile :
 * le serveur revalide tout de toute façon et c'est le seul dont l'avis compte.
 */
export function inputSystem(registry: Registry, ctx: Context): void {
  const cells: { Cell: Cell }[] = registry.getZipper([Cell]);
  const matches: { MatchStatusComponent: MatchStatusComponent }[] = registry.getZipper([
    MatchStatusComponent,
  ]);
  const match = matches[0]?.MatchStatusComponent;
  if (!match) return;

  const network = ctx.libs.getNetwork<NetworkClientLibrary>();

  for (const { Cell: cell } of cells) {
    if (!cell.pressed) continue;
    cell.pressed = false;

    if (match.phase !== MatchPhase.Playing) continue;
    if (match.myMark === null || match.turn !== match.myMark) continue;

    const index = cell.row * 3 + cell.col;
    if (match.board[index] !== Mark.Empty) continue;

    network.tcp.sendData(new TextEncoder().encode(JSON.stringify({ type: 'placeMark', index })));
  }
}
