import { apiClient } from './client.js';
import type { BlackjackActionResult, BlackjackHistoryEntry } from '../types.js';

export const getCurrentSession = () =>
  apiClient.get<BlackjackActionResult>('/api/blackjack/current');

export const join = (betAmount: number) =>
  apiClient.post<BlackjackActionResult>('/api/blackjack/join', { betAmount });

export const hit = () => apiClient.post<BlackjackActionResult>('/api/blackjack/hit');

export const stand = () => apiClient.post<BlackjackActionResult>('/api/blackjack/stand');

export const getMyHistory = (limit?: number) =>
  apiClient.get<BlackjackHistoryEntry[]>(
    `/api/blackjack/history/me${limit ? `?limit=${limit}` : ''}`
  );
