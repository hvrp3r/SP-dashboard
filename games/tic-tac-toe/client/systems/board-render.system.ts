import { type Registry } from '@nanoforge-dev/ecs-client';
import { Cell, Marker, Mark } from '../components/board.component.js';
import { MatchPhase, MatchStatusComponent } from '../components/match-status.component.js';
import { StatusText } from '../components/ui.component.js';
import { postGameOver } from '../bridge.js';
import { layer } from '../main.js';

// État de rendu purement local (jamais consulté pour la logique de jeu) — remis à
// zéro quand `round` change (nouvelle manche après une égalité), pour reposer des
// marqueurs sur un plateau qui vient d'être vidé côté serveur.
let renderedRound = 0;
const renderedMarks: Mark[] = new Array(9).fill(Mark.Empty);

function statusMessage(match: MatchStatusComponent): string {
  if (match.error) return match.error;
  switch (match.phase) {
    case MatchPhase.Connecting:
      return 'Connexion…';
    case MatchPhase.WaitingOpponent:
      return "En attente de l'adversaire…";
    case MatchPhase.Won:
      if (match.winnerMark === null) return 'Partie terminée.';
      return match.winnerMark === match.myMark ? 'Tu as gagné !' : 'Tu as perdu.';
    case MatchPhase.Playing:
    default:
      return match.turn === match.myMark ? 'À toi de jouer' : "Au tour de l'adversaire";
  }
}

export function boardRenderSystem(registry: Registry): void {
  const matches: { MatchStatusComponent: MatchStatusComponent }[] = registry.getZipper([
    MatchStatusComponent,
  ]);
  const match = matches[0]?.MatchStatusComponent;
  if (!match) return;

  if (match.round !== renderedRound) {
    renderedRound = match.round;
    renderedMarks.fill(Mark.Empty);
  }

  const cells: { Cell: Cell }[] = registry.getZipper([Cell]);
  for (const { Cell: cell } of cells) {
    const index = cell.row * 3 + cell.col;
    const symbol = match.board[index];
    if (symbol !== undefined && symbol !== Mark.Empty && renderedMarks[index] !== symbol) {
      renderedMarks[index] = symbol;
      const marker = registry.spawnEntity();
      registry.addComponent(marker, new Marker(cell.x, cell.y, cell.size, symbol));
    }
  }

  const statusTexts: { StatusText: StatusText }[] = registry.getZipper([StatusText]);
  const statusText = statusTexts[0]?.StatusText;
  if (statusText) statusText.update(statusMessage(match));

  if (match.phase === MatchPhase.Won && !match.reportedGameOver && match.winnerUserId !== null) {
    match.reportedGameOver = true;
    postGameOver(match.winnerUserId);
  }

  layer.batchDraw();
}
