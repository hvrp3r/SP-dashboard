import { apiClient } from './client.js';
import type {
  MinigameQuestionView,
  MinigameSession,
  MinigameSessionDetail,
  MinigameStatus,
} from '../types.js';

export const listSessions = (status?: MinigameStatus) =>
  apiClient.get<MinigameSession[]>(`/api/minigames${status ? `?status=${status}` : ''}`);

export const getSession = (id: number) =>
  apiClient.get<MinigameSessionDetail>(`/api/minigames/${id}`);

export const listQuestions = (sessionId: number) =>
  apiClient.get<MinigameQuestionView[]>(`/api/minigames/${sessionId}/questions`);

interface CreateFlappyBirdOptions {
  endsAt: string;
  reward1st: number;
  reward2nd: number;
  reward3rd: number;
}

export const createSession = (
  gameType: string,
  title: string,
  description?: string,
  entryFee?: number,
  flappyBird?: CreateFlappyBirdOptions
) =>
  apiClient.post<MinigameSession>('/api/minigames', {
    gameType,
    title,
    description,
    entryFee,
    ...flappyBird,
  });

export const joinSession = (sessionId: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/join`);

export const addParticipant = (sessionId: number, userId: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/participants`, { userId });

export const removeParticipant = (sessionId: number, participantId: number) =>
  apiClient.delete<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/participants/${participantId}`
  );

export const askQuestion = (sessionId: number, prompt: string) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/questions`, { prompt });

export const closeQuestion = (sessionId: number, questionId: number) =>
  apiClient.post<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/questions/${questionId}/close`
  );

export const submitAnswer = (sessionId: number, questionId: number, answerText: string) =>
  apiClient.post<MinigameSessionDetail>(
    `/api/minigames/${sessionId}/questions/${questionId}/answer`,
    { answerText }
  );

export const awardParticipants = (
  sessionId: number,
  awards: { participantId: number; amount: number }[]
) => apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/award`, { awards });

export const closeSession = (sessionId: number) =>
  apiClient.post<MinigameSessionDetail>(`/api/minigames/${sessionId}/close`);
