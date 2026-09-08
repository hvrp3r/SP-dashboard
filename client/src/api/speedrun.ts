import { apiClient } from './client.js';
import type { MinigameSessionDetail, SpeedrunComGameResult } from '../types.js';

export const searchGames = (query: string) =>
  apiClient.get<SpeedrunComGameResult[]>(
    `/api/minigames/speedrun/search-games?q=${encodeURIComponent(query)}`
  );

export const submitAttempt = (sessionId: number, timeMs: number, videoUrl: string) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/speedrun/attempts`, {
    timeMs,
    videoUrl,
  });

export const updateRewards = (
  sessionId: number,
  rewards: { reward1st: number; reward2nd: number; reward3rd: number }
) =>
  apiClient.put<MinigameSessionDetail>(`/api/minigames/${sessionId}/speedrun/rewards`, rewards);

export const excludeAttempt = (sessionId: number, attemptId: number) =>
  apiClient.post<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/speedrun/attempts/${attemptId}/exclude`
  );

export const closeAndDistribute = (sessionId: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/speedrun/close-and-distribute`);

export const cancelSession = (sessionId: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/speedrun/cancel`);
