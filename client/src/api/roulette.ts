import { apiClient } from './client.js';
import type { RouletteBet, RoulettePayoutInfo, RouletteHistoryEntry, RouletteSpinResult } from '../types.js';

export const getPayouts = () => apiClient.get<RoulettePayoutInfo[]>('/api/roulette/payouts');

export const spin = (bets: RouletteBet[]) =>
  apiClient.post<RouletteSpinResult>('/api/roulette/spin', { bets });

export const getHistory = (limit?: number, mine?: boolean) => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mine) params.set('mine', 'true');
  const qs = params.toString();
  return apiClient.get<RouletteHistoryEntry[]>(`/api/roulette/history${qs ? `?${qs}` : ''}`);
};
