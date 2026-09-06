import { apiClient } from './client.js';
import type { SlotHistoryEntry, SlotSpinResult, SlotSymbolInfo } from '../types.js';

export const getStatus = () =>
  apiClient.get<{ balance: number; enabled: boolean }>('/api/slots/status');

export const getPaytable = () => apiClient.get<SlotSymbolInfo[]>('/api/slots/paytable');

export const spin = (betAmount: number) =>
  apiClient.post<SlotSpinResult>('/api/slots/spin', { betAmount });

export const getHistory = (limit?: number, mine?: boolean) => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (mine) params.set('mine', 'true');
  const qs = params.toString();
  return apiClient.get<SlotHistoryEntry[]>(`/api/slots/history${qs ? `?${qs}` : ''}`);
};
