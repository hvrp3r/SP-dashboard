import { apiClient } from './client.js';
import type { PlayerStats, User } from '../types.js';

export const getPublicProfile = (username: string) =>
  apiClient.get<User>(`/api/users/${username}`);

export const getStats = (username: string) =>
  apiClient.get<PlayerStats>(`/api/users/${username}/stats`);

export const uploadAvatar = (file: File) => {
  const formData = new FormData();
  formData.append('avatar', file);
  return apiClient.post<User>('/api/users/me/avatar', formData);
};

export const setLeaderboardVisibility = (hidden: boolean) =>
  apiClient.post<User>('/api/users/me/leaderboard-visibility', { hidden });
