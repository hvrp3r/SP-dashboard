/** État partagé, mutable, entre les systèmes (pas géré par le registry ECS — simple bookkeeping JS). */
export class GameState {
  running = false;
  gameOver = false;
  score = 0;
  reportedGameOver = false;
  /** `performance.now()` au moment du game over — évite qu'un clic quasi-simultané ne relance instantanément. */
  gameOverAt = 0;
}
