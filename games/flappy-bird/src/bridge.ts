/**
 * Contrat de communication avec la page hôte Points Sourires (voir
 * client/src/components/FlappyBirdEmbed.tsx côté SP) : un message à chaque point
 * marqué (le parent le relaie au serveur, seule source de vérité pour le score —
 * voir server/src/controllers/flappybird.controller.ts#reportPoint) puis un
 * message au game-over (`score` n'y est qu'indicatif, pour l'affichage — jamais
 * ce qui est réellement soumis). Jamais de message entrant depuis le parent.
 */
export function postPointScored(): void {
  window.parent.postMessage({ type: 'flappybird:point' }, window.location.origin);
}

export function postGameOver(score: number): void {
  window.parent.postMessage({ type: 'flappybird:gameover', score }, window.location.origin);
}
