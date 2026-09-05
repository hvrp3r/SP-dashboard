/**
 * Contrat de communication avec la page hôte Points Sourires (voir
 * client/src/components/TicTacToeEmbed.tsx côté SP). Contrairement à Flappy Bird,
 * cette iframe n'est PAS servie même-origine (son propre service NanoForge a son
 * propre port) — postMessage doit donc viser l'origine réelle du parent, reçue une
 * fois via la query string plutôt que déduite de `window.location.origin` (qui ici
 * désignerait ce service de jeu, pas la page hôte).
 */
const parentOrigin = new URLSearchParams(window.location.search).get('parentOrigin');

export function postGameOver(winnerId: number): void {
  if (!parentOrigin) return;
  window.parent.postMessage({ type: 'tictactoe:gameover', winnerId }, parentOrigin);
}
