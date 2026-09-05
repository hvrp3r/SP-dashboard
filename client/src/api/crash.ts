import { apiClient } from './client.js';
import type { CrashActionResult, CrashHistoryEntry } from '../types.js';

export const getCurrentRound = () => apiClient.get<CrashActionResult>('/api/crash/current');

export const bet = (betAmount: number) =>
  apiClient.post<CrashActionResult>('/api/crash/bet', { betAmount });

export const cashOut = () => apiClient.post<CrashActionResult>('/api/crash/cashout');

export const getMyHistory = (limit?: number) =>
  apiClient.get<CrashHistoryEntry[]>(`/api/crash/history/me${limit ? `?limit=${limit}` : ''}`);
