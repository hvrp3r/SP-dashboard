import { apiClient } from './client.js';
import type {
  EventQuestionView,
  EventSession,
  EventSessionDetail,
  EventStatus,
} from '../types.js';

export const listSessions = (status?: EventStatus) =>
  apiClient.get<EventSession[]>(`/api/events${status ? `?status=${status}` : ''}`);

export const getSession = (id: number) =>
  apiClient.get<EventSessionDetail>(`/api/events/${id}`);

export const listQuestions = (sessionId: number) =>
  apiClient.get<EventQuestionView[]>(`/api/events/${sessionId}/questions`);

interface CreateDeadlineRewardOptions {
  endsAt: string;
  reward1st: number;
  reward2nd: number;
  reward3rd: number;
  // Rattachement optionnel à une fiche jeu speedrun.com (branche speedrun uniquement).
  gameImageUrl?: string;
  gameExternalUrl?: string;
}

interface CreateTournamentOptions {
  tournamentFormat: string;
  tournamentMaxTeams: number;
  tournamentTeamSize: number;
  reward1st: number;
  reward2nd: number;
  reward3rd: number;
}

export const createSession = (
  gameType: string,
  title: string,
  description?: string,
  entryFee?: number,
  deadlineRewards?: CreateDeadlineRewardOptions,
  tournamentOptions?: CreateTournamentOptions
) =>
  apiClient.post<EventSession>('/api/events', {
    gameType,
    title,
    description,
    entryFee,
    ...deadlineRewards,
    ...tournamentOptions,
  });

export const joinSession = (sessionId: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/join`);

export const addParticipant = (sessionId: number, userId: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/participants`, { userId });

export const removeParticipant = (sessionId: number, participantId: number) =>
  apiClient.delete<EventSessionDetail>(
    `/api/events/${sessionId}/participants/${participantId}`
  );

export const askQuestion = (
  sessionId: number,
  prompt: string,
  durationSeconds?: number,
  correctAnswer?: string
) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/questions`, {
    prompt,
    durationSeconds,
    correctAnswer,
  });

export const closeQuestion = (sessionId: number, questionId: number) =>
  apiClient.post<EventSessionDetail>(
    `/api/events/${sessionId}/questions/${questionId}/close`
  );

export const submitAnswer = (sessionId: number, questionId: number, answerText: string) =>
  apiClient.post<EventSessionDetail>(
    `/api/events/${sessionId}/questions/${questionId}/answer`,
    { answerText }
  );

export const gradeAnswer = (
  sessionId: number,
  questionId: number,
  userId: number,
  correct: boolean | null
) =>
  apiClient.post<EventSessionDetail>(
    `/api/events/${sessionId}/questions/${questionId}/answers/${userId}/grade`,
    { correct }
  );

export const awardParticipants = (
  sessionId: number,
  awards: { participantId: number; amount: number }[]
) => apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/award`, { awards });

export const closeSession = (sessionId: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/close`);
