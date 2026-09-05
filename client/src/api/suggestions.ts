import { apiClient } from './client.js';
import type {
  Suggestion,
  SuggestionDetail,
  SuggestionSort,
  SuggestionStatus,
  SuggestionType,
  SuggestionVoteValue,
} from '../types.js';

export const listSuggestions = (status?: SuggestionStatus, sort: SuggestionSort = 'top') => {
  const params = new URLSearchParams({ sort });
  if (status) params.set('status', status);
  return apiClient.get<Suggestion[]>(`/api/suggestions?${params.toString()}`);
};

export const createSuggestion = (type: SuggestionType, title: string, description?: string) =>
  apiClient.post<Suggestion>('/api/suggestions', { type, title, description });

export const getSuggestion = (id: number) =>
  apiClient.get<SuggestionDetail>(`/api/suggestions/${id}`);

export const castVote = (id: number, value: SuggestionVoteValue) =>
  apiClient.post<{ userVote: SuggestionVoteValue | 0; voteCount: number }>(
    `/api/suggestions/${id}/vote`,
    { value }
  );

export const addComment = (id: number, body: string) =>
  apiClient.post<SuggestionDetail>(`/api/suggestions/${id}/comments`, { body });

export const closeSuggestion = (id: number) =>
  apiClient.post<SuggestionDetail>(`/api/suggestions/${id}/close`);

export const deleteSuggestion = (id: number) => apiClient.delete<void>(`/api/suggestions/${id}`);
