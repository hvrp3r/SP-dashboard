import { apiClient } from './client.js';
import type { EventSessionDetail } from '../types.js';

export const createTeam = (
  sessionId: number,
  tag: string,
  logoFile?: File | null
) => {
  if (logoFile) {
    const form = new FormData();
    form.append('tag', tag);
    form.append('logo', logoFile);
    return apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/tournament/teams`, form);
  }
  return apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/tournament/teams`, { tag });
};

export const updateTeam = (
  sessionId: number,
  teamId: number,
  data: { tag?: string; logoFile?: File | null; removeLogo?: boolean }
) => {
  if (data.logoFile) {
    const form = new FormData();
    if (data.tag !== undefined) form.append('tag', data.tag);
    form.append('logo', data.logoFile);
    return apiClient.put<EventSessionDetail>(
      `/api/events/${sessionId}/tournament/teams/${teamId}`,
      form
    );
  }
  return apiClient.put<EventSessionDetail>(
    `/api/events/${sessionId}/tournament/teams/${teamId}`,
    {
      ...(data.tag !== undefined ? { tag: data.tag } : {}),
      ...(data.removeLogo ? { removeLogo: true } : {}),
    }
  );
};

export const deleteTeam = (sessionId: number, teamId: number) =>
  apiClient.delete<EventSessionDetail>(`/api/events/${sessionId}/tournament/teams/${teamId}`);

export const addTeamMember = (sessionId: number, teamId: number, userId: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/tournament/teams/${teamId}/members`, {
    userId,
  });

export const removeTeamMember = (sessionId: number, teamId: number, userId: number) =>
  apiClient.delete<EventSessionDetail>(
    `/api/events/${sessionId}/tournament/teams/${teamId}/members/${userId}`
  );

export const setParticipantRating = (
  sessionId: number,
  userId: number,
  rating: number | null
) =>
  apiClient.put<EventSessionDetail>(
    `/api/events/${sessionId}/tournament/participants/${userId}/rating`,
    { rating }
  );

export const autoGenerateTeams = (sessionId: number, teamCount?: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/tournament/auto-teams`, {
    ...(teamCount !== undefined ? { teamCount } : {}),
  });

export const generateBracket = (sessionId: number) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/tournament/bracket`);

export const resetBracket = (sessionId: number) =>
  apiClient.delete<EventSessionDetail>(`/api/events/${sessionId}/tournament/bracket`);

export const resolveMatch = (sessionId: number, matchId: number, winnerTeamId: number) =>
  apiClient.post<EventSessionDetail>(
    `/api/events/${sessionId}/tournament/matches/${matchId}/winner`,
    { winnerTeamId }
  );

export const createAnnouncement = (sessionId: number, body: string) =>
  apiClient.post<EventSessionDetail>(`/api/events/${sessionId}/tournament/announcements`, { body });
