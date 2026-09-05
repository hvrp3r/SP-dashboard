import { apiClient } from './client.js';
import type { MinigameSessionDetail } from '../types.js';

export const submitScore = (sessionId: number, score: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/flappybird/attempts`, {
    score,
  });

export const updateRewards = (
  sessionId: number,
  rewards: { reward1st: number; reward2nd: number; reward3rd: number }
) =>
  apiClient.put<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/flappybird/rewards`,
    rewards
  );

export const excludeAttempt = (sessionId: number, attemptId: number) =>
  apiClient.post<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/flappybird/attempts/${attemptId}/exclude`
  );

export const closeAndDistribute = (sessionId: number) =>
  apiClient.post<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/flappybird/close-and-distribute`
  );

export const cancelSession = (sessionId: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/flappybird/cancel`);
