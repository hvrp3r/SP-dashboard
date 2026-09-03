import { apiClient } from './client.js';
import type { Season, SeasonSnapshotResponse, SeasonStatus } from '../types.js';

export const listSeasons = (status?: SeasonStatus) =>
  apiClient.get<Season[]>(`/api/seasons${status ? `?status=${status}` : ''}`);

export const getActiveSeason = () => apiClient.get<Season | null>('/api/seasons/active');

export const getSeasonSnapshot = (seasonId: number) =>
  apiClient.get<SeasonSnapshotResponse>(`/api/seasons/${seasonId}/snapshot`);

export const createSeason = (name: string, startsAt?: string) =>
  apiClient.post<Season>('/api/seasons', { name, startsAt });

export const closeSeason = (seasonId: number) =>
  apiClient.post<Season>(`/api/seasons/${seasonId}/close`);
