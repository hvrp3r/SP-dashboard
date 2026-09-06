import { apiClient } from './client.js';
import type {
  TowerActionResult,
  TowerDifficulty,
  TowerDifficultyInfo,
  TowerHistoryEntry,
} from '../types.js';

export const getCurrentGame = () => apiClient.get<TowerActionResult>('/api/tower/current');

export const getDifficulties = () =>
  apiClient.get<TowerDifficultyInfo[]>('/api/tower/difficulties');

export const startGame = (difficulty: TowerDifficulty, betAmount: number) =>
  apiClient.post<TowerActionResult>('/api/tower/start', { difficulty, betAmount });

export const pick = (cell: number) => apiClient.post<TowerActionResult>('/api/tower/pick', { cell });

export const cashOut = () => apiClient.post<TowerActionResult>('/api/tower/cashout');

export const getHistory = (limit?: number, mine?: boolean) => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mine) params.set('mine', 'true');
  const qs = params.toString();
  return apiClient.get<TowerHistoryEntry[]>(`/api/tower/history${qs ? `?${qs}` : ''}`);
};
