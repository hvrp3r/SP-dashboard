/**
 * Contrat de communication avec la page hôte Points Sourires (voir
 * client/src/components/FlappyBirdEmbed.tsx côté SP) : un unique message au
 * game-over, jamais de message entrant depuis le parent.
 */
export function postGameOver(score: number): void {
  window.parent.postMessage({ type: 'flappybird:gameover', score }, window.location.origin);
}
