import { apiClient } from './client.js';
import type { ChatMessage, ChatRoom } from '../types.js';

export const listMessages = (room: ChatRoom, roomKey?: string, afterId?: number) => {
  const params = new URLSearchParams({ room });
  if (roomKey) params.set('roomKey', roomKey);
  if (afterId) params.set('afterId', String(afterId));
  return apiClient.get<ChatMessage[]>(`/api/chat?${params.toString()}`);
};

/** Pagination arrière ("charger les messages précédents") — voir listMessagesBefore côté serveur. */
export const listMessagesBefore = (room: ChatRoom, roomKey: string, beforeId: number) => {
  const params = new URLSearchParams({ room, beforeId: String(beforeId) });
  if (roomKey) params.set('roomKey', roomKey);
  return apiClient.get<ChatMessage[]>(`/api/chat?${params.toString()}`);
};

export const sendMessage = (room: ChatRoom, body: string, roomKey?: string) =>
  apiClient.post<ChatMessage>('/api/chat', { room, roomKey: roomKey ?? '', body });
