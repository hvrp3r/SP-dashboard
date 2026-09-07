import { apiClient } from './client.js';
import type { GamblingBattleActionResult, GamblingBattleListEntry } from '../types.js';

export const listBattles = () =>
  apiClient.get<GamblingBattleListEntry[]>('/api/gambling/battles');

export const listHistory = (limit?: number) =>
  apiClient.get<GamblingBattleListEntry[]>(
    `/api/gambling/battles/history${limit ? `?limit=${limit}` : ''}`
  );

export const getBattle = (id: number) =>
  apiClient.get<GamblingBattleActionResult>(`/api/gambling/battles/${id}`);

export const createBattle = (input: { crateIds: number[]; maxPlayers: number }) =>
  apiClient.post<GamblingBattleActionResult>('/api/gambling/battles', input);

export const joinBattle = (id: number) =>
  apiClient.post<GamblingBattleActionResult>(`/api/gambling/battles/${id}/join`);

export const cancelBattle = (id: number) =>
  apiClient.post<void>(`/api/gambling/battles/${id}/cancel`);
