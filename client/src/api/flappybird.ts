import { apiClient } from './client.js';
import type { EventSessionDetail } from '../types.js';

export const startAttempt = (sessionId: number) =>
  apiClient.post<{ token: string }>(`/api/events/${sessionId}/flappybird/attempts/start`);

/** Un point marqué en jeu — le serveur incrémente lui-même le score porté par le token. */
export const reportPoint = (sessionId: number, token: string) =>
  apiClient.post<{ token: string }>(`/api/events/${sessionId}/flappybird/attempts/point`, {
    token,
  });

/** Le score soumis est celui porté par `token` (accumulé via reportPoint) — jamais un nombre local. */
export const submitScore = (sessionId: number, token: string) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/flappybird/attempts`, {
    token,
  });

export const updateRewards = (
  sessionId: number,
  rewards: { reward1st: number; reward2nd: number; reward3rd: number }
) =>
  apiClient.put<EventSessionDetail>(
    `/api/events/${sessionId}/flappybird/rewards`,
    rewards
  );

export const excludeAttempt = (sessionId: number, attemptId: number) =>
  apiClient.post<EventSessionDetail>(
    `/api/events/${sessionId}/flappybird/attempts/${attemptId}/exclude`
  );

export const closeAndDistribute = (sessionId: number) =>
  apiClient.post<EventSessionDetail>(
    `/api/events/${sessionId}/flappybird/close-and-distribute`
  );

export const cancelSession = (sessionId: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/flappybird/cancel`);
