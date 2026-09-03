import { apiClient } from './client.js';
import type { LeaderboardEntry, LeaderboardSort } from '../types.js';

export const getLeaderboard = (sort: LeaderboardSort) =>
  apiClient.get<LeaderboardEntry[]>(`/api/leaderboard?sort=${sort}`);
