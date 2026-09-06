import { apiClient } from './client.js';
import type {
  MotusAttemptHistoryEntry,
  MotusGame,
  MotusHistoryEntry,
  MotusQueueWord,
  MotusTodayAdminView,
} from '../types.js';

export const getToday = () => apiClient.get<MotusGame>('/api/motus/today');

export const submitGuess = (guess: string) =>
  apiClient.post<MotusGame>('/api/motus/guess', { guess });

export const listQueue = () => apiClient.get<MotusQueueWord[]>('/api/motus/queue');

export const addQueueWord = (word: string) =>
  apiClient.post<MotusQueueWord>('/api/motus/queue', { word });

export const removeQueueWord = (id: number) => apiClient.delete<void>(`/api/motus/queue/${id}`);

export const reorderQueueWord = (id: number, direction: 'up' | 'down') =>
  apiClient.patch<MotusQueueWord[]>(`/api/motus/queue/${id}/reorder`, { direction });

export const listHistory = (limit?: number) =>
  apiClient.get<MotusHistoryEntry[]>(`/api/motus/history${limit ? `?limit=${limit}` : ''}`);

export const getTodayAdmin = () => apiClient.get<MotusTodayAdminView>('/api/motus/today/admin');

export const overrideToday = (word: string) =>
  apiClient.put<MotusTodayAdminView>('/api/motus/today', { word });

export const listAttempts = (limit?: number) =>
  apiClient.get<MotusAttemptHistoryEntry[]>(`/api/motus/attempts${limit ? `?limit=${limit}` : ''}`);
