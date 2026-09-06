import type { MinigameGameType } from '../types.js';

export const GAME_TYPE_LABELS: Record<MinigameGameType, string> = {
  quiz: 'Quiz',
  flappy_bird: 'Flappy Bird',
};

export const GAME_TYPE_ICONS: Record<MinigameGameType, string> = {
  quiz: '🧠',
  flappy_bird: '🐦',
};

export function gameTypeLabel(gameType: string): string {
  return GAME_TYPE_LABELS[gameType as MinigameGameType] ?? gameType;
}

export function gameTypeIcon(gameType: string): string {
  return GAME_TYPE_ICONS[gameType as MinigameGameType] ?? '🎮';
}
