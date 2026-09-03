import { apiClient } from './client.js';
import type { Challenge, ChallengeStatus } from '../types.js';

export const listMyChallenges = () => apiClient.get<Challenge[]>('/api/challenges');

export const listAllChallenges = (status?: ChallengeStatus) =>
  apiClient.get<Challenge[]>(`/api/challenges/admin${status ? `?status=${status}` : ''}`);

export const createChallenge = (
  opponentIds: number[],
  wagerAmount: number,
  description?: string
) => apiClient.post<Challenge>('/api/challenges', { opponentIds, wagerAmount, description });

export const acceptChallenge = (id: number) =>
  apiClient.post<Challenge>(`/api/challenges/${id}/accept`);

export const declineChallenge = (id: number) =>
  apiClient.post<Challenge>(`/api/challenges/${id}/decline`);

export const reportResult = (id: number, winnerId: number) =>
  apiClient.post<Challenge>(`/api/challenges/${id}/report`, { winnerId });

export const arbitrateChallenge = (id: number, winnerId: number, note?: string) =>
  apiClient.post<Challenge>(`/api/challenges/${id}/arbitrate`, { winnerId, note });

export const cancelChallenge = (id: number) =>
  apiClient.post<Challenge>(`/api/challenges/${id}/cancel`);
