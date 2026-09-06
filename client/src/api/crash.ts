import { apiClient } from './client.js';
import type { CrashActionResult, CrashHistoryEntry } from '../types.js';

export const getCurrentRound = () => apiClient.get<CrashActionResult>('/api/crash/current');

export const bet = (betAmount: number, autoCashoutMultiplierX100?: number | null) =>
  apiClient.post<CrashActionResult>('/api/crash/bet', { betAmount, autoCashoutMultiplierX100 });

export const cashOut = () => apiClient.post<CrashActionResult>('/api/crash/cashout');

export const setAutoCashout = (multiplierX100: number | null) =>
  apiClient.post<CrashActionResult>('/api/crash/auto-cashout', { multiplierX100 });

export const getHistory = (limit?: number, mine?: boolean) => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mine) params.set('mine', 'true');
  const qs = params.toString();
  return apiClient.get<CrashHistoryEntry[]>(`/api/crash/history${qs ? `?${qs}` : ''}`);
};
