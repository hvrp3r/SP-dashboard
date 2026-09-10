import { apiClient } from './client.js';
import type {
  RouletteActionResult,
  RouletteBet,
  RoulettePayoutInfo,
  RouletteHistoryEntry,
} from '../types.js';

export const getCurrent = () => apiClient.get<RouletteActionResult>('/api/roulette/current');

export const getPayouts = () => apiClient.get<RoulettePayoutInfo[]>('/api/roulette/payouts');

export const placeBet = (bets: RouletteBet[]) =>
  apiClient.post<RouletteActionResult>('/api/roulette/bet', { bets });

export const getHistory = (limit?: number, mine?: boolean) => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mine) params.set('mine', 'true');
  const qs = params.toString();
  return apiClient.get<RouletteHistoryEntry[]>(`/api/roulette/history${qs ? `?${qs}` : ''}`);
};
