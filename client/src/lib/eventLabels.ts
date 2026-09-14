import type { EventGameType } from '../types.js';

export const GAME_TYPE_LABELS: Record<EventGameType, string> = {
  quiz: 'Quiz',
  flappy_bird: 'Flappy Bird',
  speedrun: 'Speedrun',
  tournament: 'Tournoi',
};

export const GAME_TYPE_ICONS: Record<EventGameType, string> = {
  quiz: '🧠',
  flappy_bird: '🐦',
  speedrun: '⏱️',
  tournament: '🏆',
};

export const TOURNAMENT_FORMAT_LABELS: Record<string, string> = {
  single_elim: 'Élimination directe',
  double_elim: 'Double élimination',
  round_robin: 'Round-robin (poule unique)',
};

export function tournamentFormatLabel(format: string): string {
  return TOURNAMENT_FORMAT_LABELS[format] ?? format;
}

export function gameTypeLabel(gameType: string): string {
  return GAME_TYPE_LABELS[gameType as EventGameType] ?? gameType;
}

export function gameTypeIcon(gameType: string): string {
  return GAME_TYPE_ICONS[gameType as EventGameType] ?? '🎮';
}
