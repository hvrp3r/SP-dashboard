import type { MinigameGameType } from '../types.js';

export const GAME_TYPE_LABELS: Record<MinigameGameType, string> = {
  quiz: 'Quiz',
};

export function gameTypeLabel(gameType: string): string {
  return GAME_TYPE_LABELS[gameType as MinigameGameType] ?? gameType;
}
