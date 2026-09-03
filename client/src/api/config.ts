import { apiClient } from './client.js';
import type { AdminConfigEntry } from '../types.js';

export const listConfig = () => apiClient.get<AdminConfigEntry[]>('/api/config');

export const updateConfig = (key: string, value: string) =>
  apiClient.put<AdminConfigEntry>(`/api/config/${key}`, { value });
